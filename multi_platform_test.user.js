// ==UserScript==
// @name         goodJobs · 智联招聘/前程无忧
// @namespace    https://github.com/keyuanrong/resume-agent
// @version      2026-10-05.3
// @description  与 Boss 相同的控制面板；支持筛选不发送和智联达到阈值后投递在线简历并建立沟通
// @match        https://www.zhaopin.com/*
// @match        https://sou.zhaopin.com/*
// @match        https://jobs.zhaopin.com/*
// @match        https://www.51job.com/*
// @match        https://we.51job.com/*
// @match        https://jobs.51job.com/*
// @match        https://51job.com/*
// @match        https://*.51job.com/*
// @match        https://yingjiesheng.com/*
// @match        https://*.yingjiesheng.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      127.0.0.1
// @noframes
// ==/UserScript==

(function () {
    'use strict';
    function keywordRemaining(state, limit) {
        const used = Number(state.keywordProcessed?.[state.keywordIndex] || 0);
        return Math.max(0, Math.max(1, Number(limit) || 20) - used);
    }
    function recordKeywordView(state) {
        const index = Number(state.keywordIndex || 0);
        return {
            ...state,
            totalProcessed: Number(state.totalProcessed || 0) + 1,
            keywordProcessed: {
                ...(state.keywordProcessed || {}),
                [index]: Number(state.keywordProcessed?.[index] || 0) + 1,
            },
        };
    }
    async function waitForPlatformGreeting(input, timeoutMs = 2500) {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const value = String(input?.value ?? input?.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (value || Date.now() >= deadline) return value;
            await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
        }
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {keywordRemaining, recordKeywordView, waitForPlatformGreeting};
        return;
    }
    if (window.top !== window.self) return;

    const SERVER = 'http://127.0.0.1:8000';
    const SCRIPT_VERSION = '2026-10-05.3';
    const DETAIL_REQUEST_KEY = 'resumeAgent:platformTest:detailRequest';
    const DETAIL_RESPONSE_KEY = 'resumeAgent:platformTest:detailResponse';
    const APPLICATION_REQUEST_KEY = 'resumeAgent:platformTest:applicationRequest';
    const APPLICATION_RESPONSE_KEY = 'resumeAgent:platformTest:applicationResponse';
    const CAMPUS_REQUEST_KEY = 'resumeAgent:platformTest:campusApplicationRequest';
    const RUN_STATE_KEY = 'resumeAgent:platformTest:runState';
    const LOG_KEY_PREFIX = 'resumeAgent:platformTest:logs:';
    const DEFAULT_MAX_JOBS_PER_KEYWORD = 20;
    const MANUAL_FILTER_WAIT_MS = 10000;
    const MAX_LOG_LINES = 250;
    const INSTANCE_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const isCampusHost = /^(xy|campus|young)\.51job\.com$/i.test(location.hostname)
        || /(^|\.)yingjiesheng\.com$/i.test(location.hostname);
    const platform = location.hostname.includes('zhaopin.com') ? 'zhaopin' : isCampusHost ? 'job51_campus' : 'job51';
    const LIVE_ATTEMPTS_KEY = `resumeAgent:liveAttempts:${platform}`;
    const LIVE_ATTEMPTS_CONTROL_KEY = `resumeAgent:liveAttemptsControl:${platform}`;
    const LIVE_ATTEMPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const invalidCompanies = new Set(['', '公司', '公司信息', '企业', '企业信息', '查看公司', '所属公司']);

    const definitions = {
        zhaopin: {
            name: '智联招聘',
            cards: ['.job-card', '.joblist-box__item', '[class*="joblist-box__item"]', '[class*="job-list-item"]', '[class*="jobList"] [class*="item"]', '[class*="job-list"] [class*="item"]', '[role="listitem"]'],
            title: ['.job-card__name', '.job-card__title-main', '.job-card__title-row', '.iteminfo__line1__jobname__name', '[class*="jobname"]', '[class*="job-name"]', '[ka^="search-list_job_"]', 'a[href*="jobdetail"]'],
            company: ['.job-card__company-name', '.job-card__company-name--link', '.iteminfo__line1__compname__name', '[class*="compname"]', '[ka^="search-list_company_"]', '.company-name', '[class*="companyName"]', 'a[href*="company"]'],
            salary: ['.job-card__salary', '[class*="salary"]', '.salary'],
            link: ['a[href*="jobdetail"]', 'a[ka^="search-list_job_"]', 'a[href*="jobs.zhaopin.com"]', 'a[href*="/job/"]'],
            searchInputs: ['input[placeholder*="职位"]', 'input[placeholder*="关键词"]', 'input[placeholder*="搜索"]', '[class*="search"] input'],
            searchButtons: ['button[class*="search"]', '[class*="search-btn"]', '[class*="searchButton"]'],
            loginMarkers: ['[class*="user-info"]', '[class*="avatar"]', 'a[href*="resume"]'],
            loggedOutMarkers: ['a[href*="login"]', 'button[class*="login"]'],
            detailTitle: ['.job-detail-summary__title-text', '.job-detail-summary__title', 'h1', '[class*="job-title"]', '[class*="jobName"]'],
            detailCompany: ['.job-detail-summary__company-name', '.job-company-info__name', 'a[href*="company.zhaopin.com"]', '[class*="company-name"]', '[class*="companyName"]'],
            detailSalary: ['.job-detail-summary__salary', '[class*="salary"]'],
            detailBody: ['.job-detail-modules__detail .job-detail-card__body', '.job-detail-card__body', '[class*="jobDescription"]', '.describtion'],
        },
        job51: {
            name: '前程无忧',
            cards: ['.joblist-item', '[class*="joblist-item"]', '[class*="job-list-item"]'],
            title: ['.jname', '[class*="jobname"]', '[class*="job-name"]'],
            company: ['.cname', 'a.comp', '[class*="company-name"]', '[class*="companyName"]'],
            salary: ['.sal', '[class*="salary"]'],
            link: ['a[href*="jobs.51job.com/"][href*=".html"]:not([href*="/all/co"])', '.jname a[href*=".html"]'],
            searchInputs: ['input[placeholder*="职位"]', 'input[placeholder*="关键字"]', 'input[placeholder*="搜索"]', '#keywordInput'],
            searchButtons: ['button[class*="search"]', '[class*="search-btn"]', '.search_button'],
            loginMarkers: ['[class*="user-name"]', '[class*="avatar"]', 'a[href*="resume"]'],
            loggedOutMarkers: ['a[href*="login"]', '[class*="login"]'],
            detailTitle: ['.tHeader .cn h1', '.cn h1', '.job-detail-header .jname', '[class*="job-name"]', '[class*="jobName"]'],
            detailCompany: ['.cname', '.com_name', '.cn p.cname', 'a[href*=".51job.com"][class*="company"]'],
            detailSalary: ['.sal', '.cn strong', '[class*="salary"]'],
            detailBody: ['.job_msg', '.bmsg.job_msg', '[class*="job-detail"]', '[class*="description"]'],
        },
        job51_campus: {
            name: '应届生/校招平台',
            cards: ['.job-item', '.joblist-item', '[class*="job-item"]', '[class*="job-card"]', '[class*="joblist"] li'],
            title: ['.job-name', '.jname', '[class*="job-name"]', '[class*="jobName"]', 'h1', 'h2', 'h3'],
            company: ['.company-name', '.cname', '[class*="company-name"]', '[class*="companyName"]'],
            salary: ['.salary', '.sal', '[class*="salary"]'],
            link: ['a[href*="job"]', 'a[href*="position"]', 'a[href*="detail"]'],
            searchInputs: [], searchButtons: [], loginMarkers: ['[class*="avatar"]', '[class*="user"]'],
            loggedOutMarkers: ['a[href*="login"]', '[class*="login"]'],
            detailTitle: ['h1', '.job-name', '[class*="job-name"]'],
            detailCompany: ['.company-name', '.cname', '[class*="company-name"]'],
            detailSalary: ['.salary', '.sal', '[class*="salary"]'],
            detailBody: ['.job-detail', '.job-description', '[class*="description"]', 'main'],
        },
    };
    const definition = definitions[platform];
    const LOG_KEY = `${LOG_KEY_PREFIX}${platform}`;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = element => !!element && element.getClientRects().length > 0;
    const gmGet = (key, fallback = null) => Promise.resolve(GM_getValue(key, fallback));
    const gmSet = (key, value) => Promise.resolve(GM_setValue(key, value));
    const gmDelete = key => Promise.resolve(GM_deleteValue(key));

    const firstElement = (root, selectors, onlyVisible = false) => {
        for (const selector of selectors) {
            if (root instanceof Element && root.matches(selector) && (!onlyVisible || visible(root))) return root;
            const elements = Array.from(root.querySelectorAll(selector));
            const element = onlyVisible ? elements.find(visible) : elements[0];
            if (element) return element;
        }
        return null;
    };
    const firstText = (root, selectors) => {
        const element = firstElement(root, selectors);
        return clean(element?.getAttribute('title') || element?.innerText || element?.textContent);
    };
    const firstHref = (root, selectors) => {
        const element = firstElement(root, selectors);
        return element?.href || element?.closest('a')?.href || '';
    };
    const structuredJob = () => {
        const findJobPosting = value => {
            if (!value || typeof value !== 'object') return null;
            if (value['@type'] === 'JobPosting' || (Array.isArray(value['@type']) && value['@type'].includes('JobPosting'))) return value;
            if (Array.isArray(value)) {
                for (const item of value) {
                    const found = findJobPosting(item);
                    if (found) return found;
                }
                return null;
            }
            for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
                const found = findJobPosting(value[key]);
                if (found) return found;
            }
            return null;
        };
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const parsed = JSON.parse(script.textContent || '{}');
                const job = findJobPosting(parsed);
                if (job) return job;
            } catch (error) {
                // 非标准 JSON-LD 继续使用 DOM 兜底。
            }
        }
        return {};
    };
    const htmlToText = value => {
        const container = document.createElement('div');
        container.innerHTML = String(value || '');
        return clean(container.innerText || container.textContent);
    };
    const detailBodyText = () => {
        if (platform === 'job51') {
            const structuredDescription = htmlToText(structuredJob()?.description);
            const candidates = [];
            if (structuredDescription) candidates.push({text: structuredDescription, priority: 6});
            for (const [selectorIndex, selector] of definition.detailBody.entries()) {
                for (const element of document.querySelectorAll(selector)) {
                    const text = clean(element.innerText || element.textContent);
                    if (text.length < 40 || text.length > 30000) continue;
                    if (/热门城市.*友情链接.*关于我们/.test(text)) continue;
                    candidates.push({text, priority: definition.detailBody.length - selectorIndex});
                }
            }
            candidates.sort((left, right) => {
                const leftPreferred = /职位描述|岗位职责|任职要求|工作内容|职位要求/.test(left.text);
                const rightPreferred = /职位描述|岗位职责|任职要求|工作内容|职位要求/.test(right.text);
                return Number(rightPreferred) - Number(leftPreferred)
                    || right.priority - left.priority
                    || right.text.length - left.text.length;
            });
            return candidates[0]?.text || '';
        }
        if (platform !== 'zhaopin') return firstText(document, definition.detailBody);
        const cards = Array.from(document.querySelectorAll('.job-detail-card'));
        const candidates = [];
        for (const card of cards) {
            if (card.matches('.job-company-info-card') || card.querySelector('.job-company-info,.job-detail-publisher')) continue;
            const title = firstText(card, ['.job-detail-card__title', '.job-detail-card__header']);
            const body = firstText(card, ['.job-detail-card__body']);
            if (!body) continue;
            const preferred = /职位描述|职位详情|岗位职责|任职要求|岗位要求|工作内容/.test(title);
            candidates.push({body, preferred, length: body.length});
        }
        candidates.sort((left, right) => Number(right.preferred) - Number(left.preferred) || right.length - left.length);
        return candidates[0]?.body || firstText(document, definition.detailBody);
    };
    const normalizeCompany = value => {
        const company = clean(value).replace(/^(公司名称|所属公司)[：:]?\s*/, '');
        return invalidCompanies.has(company) ? '' : company;
    };
    const validJobTitle = value => {
        const title = clean(value);
        if (!title || title.length > 160) return '';
        if (/^(APP下载|下载APP|职位搜索|招聘信息|前程无忧|招聘网|找工作|找不到该页)$/i.test(title)) return '';
        return title;
    };
    const validSalaryText = value => {
        const salary = clean(value);
        if (!salary) return '';
        if (/^(面议|薪资面议|薪资保密)$/i.test(salary)) return salary;
        const matched = salary.match(
            /\d+(?:\.\d+)?\s*(?:元|[Kk]|千|万)?\s*(?:-|–|—|~|至)\s*\d+(?:\.\d+)?\s*(?:元|[Kk]|千|万)(?:\s*\/\s*(?:天|月|年)|\s*[·x×]\s*\d+\s*薪)?/,
        );
        return matched?.[0] || '';
    };
    const firstSalary = (root, selectors) => {
        for (const selector of selectors) {
            for (const element of root.querySelectorAll(selector)) {
                const salary = validSalaryText(element.innerText || element.textContent);
                if (salary) return salary;
            }
        }
        return '';
    };
    const normalizeIdentity = value => clean(value).toLowerCase().replace(/[\s（）()【】\[\]·•…⋯，,。.!！?？/\\_-]/g, '');
    const liveAttemptKey = job => `${normalizeIdentity(job?.company)}|${normalizeIdentity(job?.title)}`;
    const recentLiveAttempts = attempts => (Array.isArray(attempts) ? attempts : []).filter(item => {
        const clickedAt = Date.parse(item?.clickedAt || '');
        return Number.isFinite(clickedAt) && Date.now() - clickedAt < LIVE_ATTEMPT_TTL_MS;
    });
    const hasLiveAttempt = async job => {
        const attempts = await gmGet(LIVE_ATTEMPTS_KEY, []);
        const recent = recentLiveAttempts(attempts);
        if (recent.length !== (Array.isArray(attempts) ? attempts.length : 0)) await gmSet(LIVE_ATTEMPTS_KEY, recent);
        return recent.some(item => item?.key === liveAttemptKey(job));
    };
    const rememberLiveAttempt = async (job, decision, actionLabel) => {
        const attempts = await gmGet(LIVE_ATTEMPTS_KEY, []);
        const record = {
            key: liveAttemptKey(job),
            company: job.company,
            title: job.title,
            decisionId: decision.decisionId,
            actionLabel,
            clickedAt: new Date().toISOString(),
        };
        const next = [record, ...recentLiveAttempts(attempts).filter(item => item?.key !== record.key)].slice(0, 500);
        await gmSet(LIVE_ATTEMPTS_KEY, next);
    };
    const forgetLiveAttempt = async job => {
        const attempts = await gmGet(LIVE_ATTEMPTS_KEY, []);
        const key = liveAttemptKey(job);
        await gmSet(LIVE_ATTEMPTS_KEY, (Array.isArray(attempts) ? attempts : []).filter(item => item?.key !== key));
    };
    const requestLocal = (path, method = 'GET', data = null) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method,
            url: `${SERVER}${path}`,
            headers: {'Content-Type': 'application/json'},
            data: data === null ? undefined : JSON.stringify(data),
            timeout: 30000,
            onload: response => {
                if (response.status < 200 || response.status >= 300) {
                    reject(new Error(`本机接口 ${path} 返回 ${response.status}`));
                    return;
                }
                try { resolve(JSON.parse(response.responseText)); }
                catch (error) { reject(new Error(`本机接口 ${path} 返回无效 JSON`)); }
            },
            ontimeout: () => reject(new Error(`本机接口 ${path} 请求超时`)),
            onerror: () => reject(new Error(`无法连接本机接口 ${path}`)),
        });
    });
    const syncLiveAttemptReset = async () => {
        const control = await requestLocal('/api/job-history/control');
        const resetToken = clean(control?.resetToken);
        const knownToken = clean(await gmGet(LIVE_ATTEMPTS_CONTROL_KEY, ''));
        if (resetToken && resetToken !== knownToken) {
            await gmSet(LIVE_ATTEMPTS_KEY, []);
            await gmSet(LIVE_ATTEMPTS_CONTROL_KEY, resetToken);
            await addLog('已从控制台同步清空七天去重记录');
        }
    };
    const logAction = data => requestLocal('/log-action', 'POST', {platform, scene: 'platform_full_test', ...data}).catch(() => null);

    const detailMatchesRequest = request => {
        if (!request || request.platform !== platform || !request.url) return false;
        if (Date.now() - Number(request.createdAt || 0) > 60000) return false;
        try {
            const expected = new URL(request.url);
            const expectedToken = expected.pathname.split('/').filter(Boolean).pop()?.split('.')[0];
            return expectedToken && location.pathname.includes(expectedToken);
        } catch (error) {
            return false;
        }
    };
    const waitForDetail = async () => {
        const started = Date.now();
        while (Date.now() - started < 15000) {
            const detailText = detailBodyText();
            // 智联会先渲染一行 SEO 摘要，再异步加载完整 JD，不能看到摘要就立刻回传。
            if (detailText.length >= 120) return;
            if (Date.now() - started >= 5000 && (detailText || structuredJob()?.description)) return;
            await sleep(300);
        }
    };
    const extractDetailPage = request => {
        const structured = structuredJob();
        const structuredCompany = structured?.hiringOrganization?.name || structured?.company?.name;
        const body = detailBodyText() || htmlToText(structured?.description);
        const extractedTitle = validJobTitle(clean(structured?.title))
            || validJobTitle(firstText(document, definition.detailTitle));
        return {
            requestId: request.id,
            platform,
            externalId: request.externalId,
            url: location.href,
            title: extractedTitle || request.title || '',
            company: normalizeCompany(firstText(document, definition.detailCompany) || structuredCompany),
            salary: firstSalary(document, definition.detailSalary) || validSalaryText(structured?.baseSalary?.value),
            detail: body,
            detailSource: body ? 'detail_page' : 'missing',
            detailLength: body.length,
            extractedAt: new Date().toISOString(),
        };
    };
    const runDetailWorker = async () => {
        const request = await gmGet(DETAIL_REQUEST_KEY);
        if (!detailMatchesRequest(request)) return false;
        await waitForDetail();
        await gmSet(DETAIL_RESPONSE_KEY, extractDetailPage(request));
        await sleep(200);
        window.close();
        return true;
    };

    const createPanel = () => {
        const ctn = document.createElement('div');
        const btnBox = document.createElement('div');
        const clearBtn = document.createElement('div');
        const runBtn = document.createElement('div');
        const foldBtn = document.createElement('div');
        const msgList = document.createElement('div');
        ctn.id = 'resume-agent-platform-runner';
        ctn.style.cssText = 'position:fixed;bottom:16px;left:16px;width:380px;background-color:rgba(0,0,0,.5);color:#fff;z-index:2147483647;font-size:14px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        btnBox.style.cssText = 'width:380px;height:32px;display:flex;align-items:center;justify-content:flex-end';
        clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = 'width:60px;height:32px;line-height:32px;text-align:center;cursor:pointer;user-select:none';
        msgList.style.cssText = 'box-sizing:border-box;width:380px;height:240px;padding:2px 12px 8px;overflow-y:auto;display:flex;flex-direction:column;gap:4px';
        clearBtn.textContent = '清空';
        runBtn.textContent = '开始';
        foldBtn.textContent = '收起';
        ctn.append(btnBox, msgList);
        btnBox.append(clearBtn, runBtn, foldBtn);
        document.body.appendChild(ctn);
        foldBtn.addEventListener('click', () => {
            const expanded = foldBtn.textContent === '收起';
            msgList.style.height = expanded ? '32px' : '240px';
            foldBtn.textContent = expanded ? '展开' : '收起';
            msgList.scrollTop = msgList.scrollHeight;
        });
        return {ctn, clearBtn, runBtn, foldBtn, list: msgList};
    };

    let ui = null;
    let running = false;
    const renderLogs = lines => {
        ui.list.replaceChildren();
        for (const message of lines) {
            const item = document.createElement('div');
            item.textContent = message;
            ui.list.appendChild(item);
        }
        ui.list.scrollTop = ui.list.scrollHeight;
    };
    const addLog = async message => {
        const lines = await gmGet(LOG_KEY, []);
        const next = [...(Array.isArray(lines) ? lines : []), String(message)].slice(-MAX_LOG_LINES);
        await gmSet(LOG_KEY, next);
        if (ui) renderLogs(next);
    };
    const divider = () => addLog('----------------------------------------');
    const clearLogs = async () => {
        await gmSet(LOG_KEY, []);
        renderLogs([]);
    };
    const setRunButton = state => {
        if (!ui) return;
        ui.runBtn.textContent = state?.active ? (state.paused ? '继续' : '暂停') : '开始';
    };
    const navigationType = () => {
        const entry = performance.getEntriesByType?.('navigation')?.[0];
        return entry?.type || 'navigate';
    };

    const authState = () => {
        if (/login|passport/i.test(location.pathname)) return '未登录';
        if (getCards().length) return '已进入岗位列表';
        if (firstElement(document, definition.loginMarkers, true)) return '已登录';
        return '登录状态待页面确认';
    };
    const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const findTextButton = text => Array.from(document.querySelectorAll('button,a')).find(element => visible(element) && clean(element.innerText) === text);
    const readState = async () => {
        const state = await gmGet(RUN_STATE_KEY, {});
        return state?.platform === platform ? state : {};
    };
    const saveState = state => gmSet(RUN_STATE_KEY, {...state, platform, updatedAt: Date.now()});
    const claimState = async state => {
        const claimed = {...state, ownerId: INSTANCE_ID};
        await saveState(claimed);
        return claimed;
    };
    const waitIfPaused = async () => {
        while (true) {
            const state = await readState();
            if (!state.active) throw new Error('运行已停止');
            if (state.ownerId && state.ownerId !== INSTANCE_ID) throw new Error('运行已由新页面接管');
            if (!state.paused) return state;
            await sleep(350);
        }
    };
    const applySearch = async (keyword, state) => {
        const input = firstElement(document, definition.searchInputs, true);
        if (!input) throw new Error('没有找到搜索输入框，请进入岗位搜索页');
        setInputValue(input, keyword);
        let next = {...state, phase: 'collect', currentKeyword: keyword, searchStartedAt: Date.now(), pendingNavigation: false};
        await saveState(next);
        await addLog(`本轮搜索关键词：${keyword}`);
        if (platform === 'job51') {
            // 前程无忧搜索按钮的站内跳转不会稳定地让用户脚本继续执行。
            // 直接保留城市、薪资等现有查询参数，只替换关键词并进行完整页面导航；
            // 新页面会从已保存的 collect 状态自动续跑。
            const currentUrl = new URL(location.href);
            const target = new URL('https://we.51job.com/pc/search');
            // 只继承搜索页已有的城市、薪资等筛选参数，不能继承 www/裸域名，
            // 否则 51job.com/pc/search 会被重定向到 /in/missing.php。
            if (currentUrl.pathname === '/pc/search') {
                for (const [name, value] of currentUrl.searchParams.entries()) {
                    target.searchParams.append(name, value);
                }
            }
            target.searchParams.set('keyword', keyword);
            if (!target.searchParams.has('searchType')) target.searchParams.set('searchType', '2');
            const currentKeyword = clean(currentUrl.searchParams.get('keyword'));
            if (normalizeIdentity(currentKeyword) === normalizeIdentity(keyword)) {
                await addLog('当前页面已经是目标搜索词，直接扫描岗位列表');
                await sleep(800);
                return next;
            }
            next = {...next, pendingNavigation: true, navigationTarget: target.toString()};
            await saveState(next);
            await addLog('正在打开下一搜索结果页，页面加载后将自动继续');
            location.assign(target.toString());
            // 当前文档仍可能短暂保留旧页面 DOM，必须立刻交给新页面实例接管，
            // 不能继续把首页推荐或上一关键词卡片当作新搜索结果。
            throw new Error('运行已由新页面接管');
        }
        const button = firstElement(document, definition.searchButtons, true) || findTextButton('搜索');
        if (!button) throw new Error('没有找到搜索按钮');
        button.click();
        await sleep(3500);
        return next;
    };
    const canonicalJobUrl = value => {
        if (!clean(value)) return '';
        try {
            const url = new URL(value, location.href);
            return `${url.origin}${url.pathname}`.replace(/\/$/, '');
        } catch (error) {
            return clean(value).split(/[?#]/)[0].replace(/\/$/, '');
        }
    };
    const is51JobDetailUrl = value => {
        const url = canonicalJobUrl(value);
        return /^https:\/\/jobs\.51job\.com\/[^?#]+\/\d+\.html$/i.test(url) ? url : '';
    };
    const is51JobCampusUrl = value => {
        try {
            const hostname = new URL(value, location.href).hostname.toLowerCase();
            return hostname === 'xy.51job.com'
                || hostname === 'campus.51job.com'
                || hostname === 'young.51job.com'
                || hostname === 'yingjiesheng.com'
                || hostname.endsWith('.yingjiesheng.com');
        } catch (error) {
            return false;
        }
    };
    const build51JobSearchApiUrl = (keyword, limit) => {
        const resourceEntries = Array.from(performance.getEntriesByType?.('resource') || []).reverse();
        const observed = resourceEntries.find(entry => {
            try { return new URL(entry.name).pathname === '/api/job/search-pc'; }
            catch (error) { return false; }
        });
        const url = observed
            ? new URL(observed.name)
            : new URL('https://we.51job.com/api/job/search-pc');
        const pageUrl = new URL(location.href);
        const filterNames = [
            'jobArea', 'jobArea2', 'landmark', 'metro', 'salary', 'workYear',
            'degree', 'companyType', 'companySize', 'jobType', 'issueDate',
            'industry', 'function', 'sortType',
        ];
        for (const name of filterNames) {
            if (pageUrl.searchParams.has(name)) url.searchParams.set(name, pageUrl.searchParams.get(name) || '');
            else if (!url.searchParams.has(name)) url.searchParams.set(name, name === 'jobArea' ? '000000' : '');
        }
        url.searchParams.set('api_key', '51job');
        url.searchParams.set('timestamp', String(Date.now()));
        url.searchParams.set('keyword', keyword);
        url.searchParams.set('searchType', '2');
        url.searchParams.set('pageNum', '1');
        url.searchParams.set('pageSize', String(Math.max(1, Math.min(Number(limit) || 20, 50))));
        url.searchParams.set('source', '1');
        url.searchParams.set('scene', '7');
        return url.toString();
    };
    const fetch51JobSearchApi = async (keyword, limit) => {
        if (platform !== 'job51') return [];
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const apiUrl = build51JobSearchApiUrl(keyword, limit);
        const response = await pageWindow.fetch(apiUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {Accept: 'application/json'},
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`搜索接口返回 HTTP ${response.status}`);
        if (text.trim().startsWith('<')) throw new Error('搜索接口触发了前程无忧安全验证');
        let data;
        try { data = JSON.parse(text); }
        catch (error) { throw new Error('搜索接口没有返回有效 JSON'); }
        if (data?.status !== '1' && data?.status !== 1) {
            throw new Error(`搜索接口返回失败：${clean(data?.message) || 'unknown'}`);
        }
        const items = Array.isArray(data?.resultbody?.job?.items) ? data.resultbody.job.items : [];
        return items.slice(0, limit).map((item, index) => {
            const externalId = String(item?.jobId || `job51-api-${index}`);
            const detail = htmlToText(item?.jobDescribe);
            const suppliedUrl = canonicalJobUrl(
                item?.jobHref || item?.jobUrl || item?.jobDetailUrl || item?.detailUrl || item?.href
            );
            const usableJobUrl = /^https:\/\/jobs\.51job\.com\/[^?#]+\/\d+\.html$/i.test(suppliedUrl)
                ? suppliedUrl
                : '';
            return {
                platform,
                listIndex: index,
                externalId,
                // /x/<jobId>.html 会被前程无忧跳到 missing.php，不能作为岗位地址兜底。
                url: usableJobUrl,
                title: clean(item?.jobName),
                company: normalizeCompany(item?.fullCompanyName || item?.companyName),
                salary: validSalaryText(item?.provideSalaryString),
                detail,
                detailSource: detail.length >= 40 ? 'search_api' : 'search_api_summary',
                detailLength: detail.length,
            };
        }).filter(job => job.title);
    };
    const fallbackCardsFromJobLinks = () => {
        const selectors = platform === 'zhaopin'
            ? 'a[href*="jobdetail"],a[href*="jobs.zhaopin.com"],a[href*="/job/"]'
            : 'a[href*="jobs.51job.com/"][href*=".html"]:not([href*="/all/co"])';
        const links = Array.from(document.querySelectorAll(selectors)).filter(visible);
        const cards = [];
        const seenHrefs = new Set();
        for (const link of links) {
            const href = canonicalJobUrl(link.href || '');
            if (!href || seenHrefs.has(href)) continue;
            if (platform === 'job51' && !/\/\d+\.html$/i.test(new URL(href).pathname)) continue;
            seenHrefs.add(href);
            if (platform === 'job51') {
                const ancestors = [link, link.parentElement, link.parentElement?.parentElement,
                    link.parentElement?.parentElement?.parentElement, link.parentElement?.parentElement?.parentElement?.parentElement]
                    .filter(Boolean);
                const completeCard = ancestors.find(element => (
                    firstText(element, definition.title) && firstText(element, definition.company)
                ));
                cards.push(completeCard || link);
            } else {
                // 链接本身就是可靠的最小岗位单元；公司等信息可由详情页补齐。
                cards.push(link);
            }
        }
        return cards;
    };
    const dedupeJobCards = cards => {
        const selected = new Map();
        for (const card of cards) {
            const url = canonicalJobUrl(firstHref(card, definition.link));
            const title = firstText(card, definition.title)
                || (card.matches?.('a') ? clean(card.innerText || card.textContent) : '');
            const company = normalizeCompany(firstText(card, definition.company));
            const key = url || `${normalizeIdentity(title)}|${normalizeIdentity(company)}`;
            if (!key) continue;
            const existing = selected.get(key);
            const quality = (title ? 2 : 0) + (company ? 4 : 0) + Math.min(2, clean(card.innerText || card.textContent).length / 200);
            if (!existing || quality > existing.quality) selected.set(key, {card, quality});
        }
        return Array.from(selected.values(), item => item.card);
    };
    function getCards() {
        if (platform === 'job51') {
            // 前程无忧新版主搜索结果是无链接的 .joblist-item；带 jobs.51job.com
            // 链接的是右侧推荐区，不能作为主列表，否则会把公共区域误判为职位详情。
            return Array.from(document.querySelectorAll('.joblist-item')).filter(card => (
                visible(card) && firstText(card, definition.title)
            ));
        }
        let best = [];
        for (const selector of definition.cards) {
            const cards = Array.from(document.querySelectorAll(selector)).filter(card => (
                visible(card) && (firstHref(card, definition.link) || firstText(card, definition.title))
            ));
            if (cards.length > best.length) best = cards;
        }
        const linkCards = fallbackCardsFromJobLinks();
        const candidates = best.length ? best : linkCards;
        return dedupeJobCards(candidates);
    }
    const elementSignature = element => {
        if (!element) return '';
        const classes = String(element.className || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes ? `.${classes}` : ''}`;
    };
    const collectListDiagnostics = () => {
        const linkSelector = platform === 'zhaopin'
            ? 'a[href*="jobdetail"],a[href*="jobs.zhaopin.com"],a[href*="/job/"]'
            : 'a[href*="jobs.51job.com/"][href*=".html"]:not([href*="/all/co"])';
        const links = Array.from(document.querySelectorAll(linkSelector)).filter(visible);
        return {
            path: location.pathname,
            title: clean(document.title),
            selectorCounts: definition.cards.map(selector => ({selector, count: document.querySelectorAll(selector).length})),
            visibleJobLinkCount: links.length,
            linkSamples: links.slice(0, 8).map(link => ({
                text: clean(link.innerText || link.textContent).slice(0, 100),
                path: (() => { try { return new URL(link.href).pathname; } catch (error) { return ''; } })(),
                ancestry: [link, link.parentElement, link.parentElement?.parentElement, link.parentElement?.parentElement?.parentElement]
                    .filter(Boolean).map(elementSignature),
            })),
        };
    };
    const collectStructureDiagnostics = () => {
        const root = document.querySelector('main') || document.body;
        const groups = new Map();
        const jobLikePattern = /(\d+(?:\.\d+)?\s*[-~—至]\s*\d+(?:\.\d+)?\s*(?:k|K|千|万|元)|面议|经验不限|学历|招聘)/;
        const sanitizeSample = value => clean(value)
            .replace(/1[3-9]\d{9}/g, '[手机号已隐藏]')
            .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已隐藏]');
        const elements = Array.from(root.querySelectorAll('*')).filter(visible).slice(0, 10000);
        for (const element of elements) {
            const text = clean(element.innerText || element.textContent);
            if (text.length < 8 || text.length > 1200 || !jobLikePattern.test(text)) continue;
            const signature = elementSignature(element);
            if (!signature || signature === 'div' || signature === 'span') continue;
            const item = groups.get(signature) || {signature, count: 0, samples: [], dataAttributes: new Set()};
            item.count += 1;
            if (item.samples.length < 3) item.samples.push(sanitizeSample(text).slice(0, 180));
            for (const name of element.getAttributeNames?.() || []) {
                if (name.startsWith('data-')) item.dataAttributes.add(name);
            }
            groups.set(signature, item);
        }
        const repeatedStructures = Array.from(groups.values())
            .filter(item => item.count >= 2)
            .sort((left, right) => right.count - left.count)
            .slice(0, 30)
            .map(item => ({...item, dataAttributes: Array.from(item.dataAttributes).slice(0, 12)}));
        const resourcePaths = [];
        const seenResources = new Set();
        for (const entry of performance.getEntriesByType?.('resource') || []) {
            try {
                const url = new URL(entry.name);
                const safePath = `${url.origin}${url.pathname}`;
                if (!/(job|position|search|recommend|sou|api)/i.test(safePath) || seenResources.has(safePath)) continue;
                seenResources.add(safePath);
                resourcePaths.push({path: safePath, type: entry.initiatorType || ''});
            } catch (error) {
                // 忽略浏览器内部或无效资源地址。
            }
            if (resourcePaths.length >= 50) break;
        }
        const nextData = window.__NEXT_DATA__;
        return {
            path: location.pathname,
            elementCount: elements.length,
            repeatedStructures,
            resourcePaths,
            frameworkState: nextData ? {
                nextDataPresent: true,
                page: nextData.page || '',
                topLevelKeys: Object.keys(nextData).slice(0, 20),
                propsKeys: Object.keys(nextData.props || {}).slice(0, 20),
            } : {nextDataPresent: false},
        };
    };
    const pageDiagnostics = () => {
        const jobLinkSelector = platform === 'zhaopin'
            ? 'a[href*="jobdetail"],a[href*="jobs.zhaopin.com"],a[href*="/job/"]'
            : 'a[href*="jobs.51job.com/"][href*=".html"]:not([href*="/all/co"])';
        return `地址=${location.pathname}｜候选职位链接=${document.querySelectorAll(jobLinkSelector).length}｜页面标题=${clean(document.title)}`;
    };
    const loadCards = async targetCount => {
        let cards = getCards();
        let stableRounds = 0;
        for (let round = 0; round < 24; round += 1) {
            await waitIfPaused();
            if (cards.length >= targetCount || stableRounds >= 3) break;
            const previousCount = cards.length;
            window.scrollBy({top: Math.max(500, window.innerHeight * 0.8), behavior: 'smooth'});
            await sleep(650);
            cards = getCards();
            stableRounds = cards.length > previousCount ? 0 : stableRounds + 1;
        }
        return cards;
    };
    const advanceResultsPage = async state => {
        if (Number(state.pageAdvanceCount || 0) >= 50) return false;
        const candidate = firstElement(document, [
            '.ant-pagination-next:not(.ant-pagination-disabled) button',
            '.pagination .next:not(.disabled) a',
            '.pager .next:not(.disabled) a',
            'button[aria-label*="下一页"]',
            'a[rel="next"]',
        ], true);
        const button = candidate || findTextButton('下一页');
        if (!button || button.disabled || button.getAttribute?.('aria-disabled') === 'true'
            || /disabled/.test(String(button.className || button.parentElement?.className || ''))) return false;
        const signature = () => getCards().slice(0, 3).map(card =>
            `${firstHref(card, definition.link)}|${firstText(card, definition.title)}`).join('\n');
        const beforeUrl = location.href;
        const beforeCards = signature();
        await saveState({...state, pageAdvanceCount: Number(state.pageAdvanceCount || 0) + 1});
        button.click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
            await sleep(300);
            if (location.href !== beforeUrl || signature() !== beforeCards) {
                await addLog(`当前搜索词尚未达到查看额度，继续下一页`);
                // 普通跳转会销毁旧页面；站内路由只改 URL 时仍需由当前页面续跑。
                setTimeout(() => runEngine(), 0);
                return true;
            }
        }
        await addLog('点击下一页后未识别到页面变化，结束当前搜索词');
        return false;
    };
    const capture51JobDetailUrl = async card => {
        if (platform !== 'job51') return '';
        // 只读 DOM 中已有的地址，不再点击岗位标题来拦截 window.open。
        // 部分校招岗位点击标题会跳到前程无忧旗下的应届生平台，既破坏当前任务，
        // 也无法继续使用主站的详情页解析与投递逻辑。
        const candidates = [card, ...Array.from(card.querySelectorAll('*'))];
        for (const element of candidates) {
            for (const attribute of ['href', 'data-href', 'data-url', 'data-job-url', 'data-link']) {
                const url = is51JobDetailUrl(element.getAttribute?.(attribute));
                if (url) return url;
            }
        }
        const html = String(card.outerHTML || '').replace(/\\\//g, '/');
        const embedded = html.match(/https?:\/\/jobs\.51job\.com\/[^“”"'<>\s]+\/\d+\.html/i)?.[0];
        return is51JobDetailUrl(embedded);
    };
    const findMatching51JobDetailUrl = (title, company) => {
        if (platform !== 'job51') return '';
        const titleIdentity = normalizeIdentity(title);
        if (titleIdentity.length < 4) return '';
        const companyIdentity = normalizeIdentity(company)
            .replace(/(?:有限责任公司|股份有限公司|有限公司|集团公司|集团|公司)$/g, '');
        const matches = [];
        for (const link of document.querySelectorAll('a[href*="jobs.51job.com/"][href*=".html"]:not([href*="/all/co"])')) {
            const url = canonicalJobUrl(link.href || '');
            if (!/^https:\/\/jobs\.51job\.com\/[^?#]+\/\d+\.html$/i.test(url)) continue;
            const textIdentity = normalizeIdentity(link.innerText || link.textContent);
            if (!textIdentity.includes(titleIdentity)) continue;
            matches.push({url, textIdentity});
        }
        if (matches.length === 1) return matches[0].url;
        if (companyIdentity.length >= 4) {
            const companyToken = companyIdentity.slice(0, Math.min(10, companyIdentity.length));
            const companyMatches = matches.filter(item => item.textIdentity.includes(companyToken));
            if (companyMatches.length === 1) return companyMatches[0].url;
        }
        return '';
    };
    const extractCard = async (card, index) => {
        const title = firstText(card, definition.title)
            || (card.matches?.('a') ? clean(card.innerText || card.textContent) : '');
        const company = normalizeCompany(firstText(card, definition.company));
        const salary = firstSalary(card, definition.salary)
            || (platform === 'job51' ? validSalaryText(card.innerText || card.textContent) : '');
        const directUrl = canonicalJobUrl(firstHref(card, definition.link));
        const capturedUrl = directUrl || await capture51JobDetailUrl(card);
        const externalCampusUrl = Array.from(card.querySelectorAll('a[href]'))
            .map(link => link.href || link.getAttribute('href') || '')
            .find(is51JobCampusUrl) || '';
        // 主列表本身无链接时，允许和页面已有标准岗位链接按“岗位名 + 公司”精确对应。
        // 不直接把右侧推荐区当列表，避免重新引入重复卡片和 APP 下载等公共内容。
        const url = capturedUrl || findMatching51JobDetailUrl(title, company);
        let externalId = `${platform}-${index}`;
        try { externalId = new URL(url).pathname.split('/').filter(Boolean).pop() || externalId; } catch (error) {}
        return {
            platform, externalId, url, title, company, salary,
            detail: clean(card.innerText || card.textContent),
            detailSource: externalCampusUrl ? 'external_campus_summary' : 'job_card',
            externalCampusUrl,
        };
    };
    const fetchInlineZhaopinDetail = async (cardJob, card) => {
        card.scrollIntoView({block: 'center'});
        await sleep(180);
        const titleTarget = firstElement(card, ['.job-card__name', '.job-card__title-row']);
        const clickTargets = [card, titleTarget, card].filter(Boolean);
        for (const [attempt, clickTarget] of clickTargets.entries()) {
            // 某些智联卡片把监听器绑在卡片本体，另一些版本绑在标题区域。
            // 先用原生 click，失败后再补齐完整鼠标事件序列；不传油猴包装的 window。
            clickTarget.click();
            if (attempt > 0) {
                for (const type of ['mousedown', 'mouseup', 'click']) {
                    clickTarget.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true}));
                }
            }
            const attemptStarted = Date.now();
            while (Date.now() - attemptStarted < 4500) {
                await waitIfPaused();
                const title = firstText(document, definition.detailTitle);
                const company = normalizeCompany(firstText(document, definition.detailCompany));
                const body = detailBodyText();
                const normalizedTitle = normalizeIdentity(title);
                const normalizedCardTitle = normalizeIdentity(cardJob.title);
                const normalizedCompany = normalizeIdentity(company);
                const normalizedCardCompany = normalizeIdentity(cardJob.company);
                const isOutsourcedClient = /^客户公司[：:]/.test(company);
                const titleMatched = normalizedTitle && normalizedCardTitle
                    && (normalizedTitle.includes(normalizedCardTitle) || normalizedCardTitle.includes(normalizedTitle));
                const companyMatched = isOutsourcedClient || !normalizedCardCompany || !normalizedCompany
                    || normalizedCompany.includes(normalizedCardCompany)
                    || normalizedCardCompany.includes(normalizedCompany);
                if (titleMatched && companyMatched && body.length >= 40) {
                    const resolvedCompany = isOutsourcedClient && cardJob.company
                        ? `${cardJob.company}（${company}）`
                        : company || cardJob.company;
                    return {
                        ...cardJob,
                        title: title || cardJob.title,
                        company: resolvedCompany,
                        clientCompany: isOutsourcedClient ? company.replace(/^客户公司[：:]\s*/, '') : '',
                        salary: firstSalary(document, definition.detailSalary) || cardJob.salary,
                        detail: body || cardJob.detail,
                        detailSource: 'inline_detail_panel',
                        detailLength: body.length,
                        detailAttempts: attempt + 1,
                    };
                }
                await sleep(300);
            }
        }
        return {
            ...cardJob,
            detailSource: 'job_card_inline_timeout',
            detailLength: clean(cardJob.detail).length,
            observedTitle: firstText(document, definition.detailTitle),
            observedCompany: normalizeCompany(firstText(document, definition.detailCompany)),
            observedDetailLength: detailBodyText().length,
            cardStructure: Array.from(card.children).slice(0, 12).map(elementSignature),
        };
    };
    const fetchDetail = async (cardJob, card) => {
        if (platform === 'zhaopin' && card?.matches?.('.job-card')) {
            return fetchInlineZhaopinDetail(cardJob, card);
        }
        if (!cardJob.url) return cardJob;
        const request = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            platform,
            externalId: cardJob.externalId,
            url: cardJob.url,
            title: cardJob.title,
            company: cardJob.company,
            createdAt: Date.now(),
        };
        await gmDelete(DETAIL_RESPONSE_KEY);
        await gmSet(DETAIL_REQUEST_KEY, request);
        const detailTab = GM_openInTab(cardJob.url, {active: false, insert: true, setParent: true});
        const started = Date.now();
        try {
            while (Date.now() - started < 22000) {
                await waitIfPaused();
                const response = await gmGet(DETAIL_RESPONSE_KEY);
                if (response?.requestId === request.id) {
                    return {
                        ...cardJob,
                        ...response,
                        // 前程无忧详情页顶部存在“APP下载”等通用标题，卡片岗位名更可靠。
                        title: platform === 'job51' ? cardJob.title : response.title || cardJob.title,
                        company: response.company || cardJob.company,
                        salary: response.salary || cardJob.salary,
                        detail: response.detail || cardJob.detail,
                    };
                }
                await sleep(400);
            }
            return {...cardJob, detailSource: 'job_card_timeout'};
        } finally {
            if (detailTab?.close) detailTab.close();
            await gmDelete(DETAIL_REQUEST_KEY);
        }
    };
    const visibleElements = selectors => selectors.flatMap(selector => (
        Array.from(document.querySelectorAll(selector)).filter(visible)
    ));
    const findActionByText = (pattern, root = document) => Array.from(root.querySelectorAll('button,a,[role="button"]'))
        .find(element => visible(element) && pattern.test(clean(element.innerText || element.textContent)));
    const findZhaopinContactAction = () => {
        const selectors = [
            '.job-detail-summary__prechat button', '.job-detail-summary__prechat',
            '.job-detail-chat__btn', '.job-detail-summary button',
        ];
        const pattern = /^(立即沟通|马上沟通|发起沟通|继续沟通|在线沟通|去沟通|立即投递|投递职位|申请职位|立即申请)$/;
        return visibleElements(selectors).find(element => pattern.test(clean(element.innerText || element.textContent)))
            || findActionByText(pattern);
    };
    const findVisibleDialog = () => visibleElements([
        '.a-job-apply-workflow', '.a-job-apply-resume-selection-panel', '.a-job-apply-block-panel',
        '.a-job-apply-error-message-panel', '.a-job-apply-invite-code-panel',
        '.a-dialog', '.ivu-modal', '[role="dialog"]', '[class*="dialog"]', '[class*="modal"]',
    ]).find(element => clean(element.innerText || element.textContent).length > 0) || null;
    const findChatInput = () => visibleElements([
        'textarea[placeholder*="消息"]', 'textarea[placeholder*="沟通"]',
        '[class*="chat"] textarea', '[class*="message"] textarea',
        '[class*="chat"] [contenteditable="true"]', '[class*="message"] [contenteditable="true"]',
    ])[0] || null;
    const editableValue = element => clean(element?.matches?.('textarea,input') ? element.value : element?.textContent);
    const setEditableValue = (element, value) => {
        if (element.matches('textarea,input')) {
            const prototype = element.matches('textarea') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (setter) setter.call(element, value); else element.value = value;
        } else {
            element.textContent = value;
        }
        element.dispatchEvent(new Event('input', {bubbles: true}));
        element.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const contactSuccessText = () => {
        const greetingModal = visibleElements(['.deliver-greeting-modal'])[0];
        if (greetingModal) {
            return clean(firstText(greetingModal, ['.deliver-greeting-modal__title', '.deliver-greeting-modal__content-text'])
                || greetingModal.innerText || '招呼已发送');
        }
        const selectors = ['.a-toast__content', '.ivu-message-notice-content', '[class*="toast"]', '[class*="message"]'];
        return visibleElements(selectors).map(element => clean(element.innerText || element.textContent))
            .find(text => /沟通成功|发送成功|招呼已发送|投递成功|申请成功|已投递/.test(text)) || '';
    };
    const contactDiagnostics = (button, beforeUrl) => {
        const candidateSelectors = [
            '.deliver-greeting-modal', '.a-job-apply-workflow', '[class*="job-apply"]',
            '.job-detail-chat__popup', '.a-dialog', '.ivu-modal', '[role="dialog"]',
            '[class*="chat"]', '[class*="message"]',
        ];
        const candidates = visibleElements(candidateSelectors).slice(0, 12).map(element => ({
            node: elementSignature(element),
            text: clean(element.innerText || element.textContent).slice(0, 180),
        }));
        const buttons = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible)
            .map(element => ({node: elementSignature(element), text: clean(element.innerText || element.textContent).slice(0, 80)}))
            .filter(item => /沟通|发送|申请|投递|简历|确认|取消|继续|查看/.test(item.text))
            .slice(0, 16);
        return {
            beforeUrl,
            currentUrl: location.href,
            urlChanged: location.href !== beforeUrl,
            actionButton: {
                node: elementSignature(button),
                text: clean(button?.innerText || button?.textContent),
                disabled: !!button?.disabled,
            },
            activeElement: elementSignature(document.activeElement),
            candidates,
            buttons,
        };
    };
    const waitForContactOutcome = async (button, beforeText, timeoutMs = 15000, ignoredDialog = null) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const successText = contactSuccessText();
            if (successText) return {type: 'success', detail: successText};
            const currentText = clean(button?.innerText || button?.textContent);
            if (currentText !== beforeText && /已沟通|继续沟通|查看沟通|已投递|投递成功|申请成功/.test(currentText)) {
                return {type: 'success', detail: currentText};
            }
            const chatInput = findChatInput();
            if (chatInput) return {type: 'chat_input', element: chatInput};
            const dialog = findVisibleDialog();
            if (dialog && dialog !== ignoredDialog && !ignoredDialog?.contains?.(dialog)) {
                return {type: 'dialog', element: dialog};
            }
            const chatPopup = visibleElements(['.job-detail-chat__popup'])[0];
            if (chatPopup) return {type: 'unsupported_popup', detail: clean(chatPopup.innerText || chatPopup.textContent).slice(0, 300)};
            await sleep(300);
        }
        return {type: 'unknown', detail: '点击后未识别到成功状态、聊天输入框或确认弹窗'};
    };
    const waitForGreetingSent = async (button, beforeText, input, timeoutMs = 12000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const successText = contactSuccessText();
            if (successText) return {success: true, detail: successText};
            const currentText = clean(button?.innerText || button?.textContent);
            if (currentText !== beforeText && /(?:已发送|发送成功|继续沟通)/.test(currentText)) {
                return {success: true, detail: currentText};
            }
            if (!editableValue(input)) return {success: true, detail: '聊天输入框已清空'};
            await sleep(300);
        }
        return {success: false, reason: '点击发送后未识别到成功状态'};
    };
    const completeChatGreeting = async (input, decision, job, autoMode = false) => {
        const greeting = await waitForPlatformGreeting(input);
        if (!greeting) return {success: false, reason: '平台未预填招呼语，请在页面手动处理'};
        const confirmed = autoMode || window.confirm(
            `智联招聘已打开聊天输入框，平台预填招呼语：\n\n${greeting}\n\n是否点击“发送”？`
        );
        if (!confirmed) return {success: false, cancelled: true, reason: '用户取消发送招呼语'};
        const container = input.closest('[class*="chat"],[class*="dialog"],[role="dialog"]') || document;
        const sendButton = findActionByText(/^(发送|确认发送|立即发送)$/, container);
        if (!sendButton) return {success: false, reason: '已填入招呼语，但没有识别到发送按钮'};
        const beforeText = clean(sendButton.innerText || sendButton.textContent);
        sendButton.click();
        const outcome = await waitForGreetingSent(sendButton, beforeText, input, 12000);
        return outcome.success
            ? {...outcome, mode: 'chat_message'}
            : outcome;
    };
    const completeConfirmationDialog = async (dialog, button, decision, job, autoMode = false, allowApplication = false) => {
        const dialogText = clean(dialog.innerText || dialog.textContent).slice(0, 500);
        if (/凭证失效|登录(?:已)?失效|登录过期|请重新登录/.test(dialogText)) {
            return {
                success: false,
                authExpired: true,
                retrySafe: true,
                reason: `智联登录状态已失效，本次未发送：${dialogText}`,
            };
        }
        if (!allowApplication && /投递|申请|简历|附件/.test(dialogText)) {
            return {success: false, safeSkip: true, retrySafe: true, reason: `检测到投递或简历流程，已跳过：${dialogText}`};
        }
        if (allowApplication && /上传|添加附件|选择本地文件/.test(dialogText)) {
            return {success: false, reason: `投递弹窗要求上传附件，脚本不会自动选择本地文件：${dialogText}`};
        }
        if (!/(?:沟通|招呼|消息|聊天|投递|申请|在线简历)/.test(dialogText)) {
            return {success: false, reason: `弹窗用途不明确，已停止：${dialogText}`};
        }
        const confirmPattern = allowApplication
            ? /^(确认|确定|立即投递|确认投递|投递|申请|立即申请|继续)$/
            : /^(确认|确定|发送|确认发送|继续沟通)$/;
        const confirmButton = findActionByText(confirmPattern, dialog);
        if (!confirmButton) return {success: false, reason: `出现弹窗但没有识别到确认按钮：${dialogText}`};
        const confirmed = autoMode || window.confirm(`智联招聘出现二次确认弹窗：\n\n${dialogText}\n\n是否点击“${clean(confirmButton.innerText)}”？`);
        if (!confirmed) return {success: false, cancelled: true, reason: '用户取消二次确认'};
        const beforeText = clean(button?.innerText || button?.textContent);
        confirmButton.click();
        const outcome = await waitForContactOutcome(button, beforeText, 15000, dialog);
        if (outcome.type === 'chat_input') {
            if (allowApplication) {
                return {
                    success: true,
                    detail: '投递完成并已进入沟通页；智联已发送默认招呼语和平台简历',
                    mode: 'application_submitted',
                };
            }
            return completeChatGreeting(outcome.element, decision, job, autoMode);
        }
        return outcome.type === 'success'
            ? {success: true, detail: outcome.detail, mode: allowApplication ? 'application_submitted' : 'confirmed_contact'}
            : {success: false, reason: outcome.detail || '确认后未识别到成功状态'};
    };
    const executeZhaopinGreeting = async (job, decision, autoMode = false) => {
        const actionButton = findZhaopinContactAction();
        if (!actionButton) return {success: false, safeSkip: true, retrySafe: true, reason: '没有识别到“立即投递”或沟通按钮，本岗位已跳过'};
        const actionLabel = clean(actionButton.innerText || actionButton.textContent);
        const isApplication = /投递|申请/.test(actionLabel);
        const confirmed = autoMode || window.confirm(
            `即将进行一次真实操作：\n\n岗位：${job.title}\n公司：${job.company}\n匹配度：${decision.score}\n按钮：${actionLabel}\n${isApplication ? '该操作会投递智联在线简历并建立沟通。' : '该操作会建立沟通。'}\n\n是否继续？`
        );
        if (!confirmed) return {success: false, cancelled: true, reason: '用户取消首次确认'};
        const confirmedPlan = await requestLocal('/api/execution/plan', 'POST', {
            platform, job, decision, confirmedByUser: !autoMode,
        });
        if (!confirmedPlan.allowExecute) {
            return {success: false, reason: `后端安全锁未放行：${confirmedPlan.blockedBy || 'unknown'}`};
        }
        await logAction({action: 'zhaopin_contact_clicking', decisionId: decision.decisionId, company: job.company, title: job.title, actionLabel});
        // “立即沟通”可能点击当下就发起沟通。点击前先记录，即使页面回执无法识别也不会重复点击。
        await rememberLiveAttempt(job, decision, actionLabel);
        const beforeUrl = location.href;
        actionButton.click();
        let outcome = await waitForContactOutcome(actionButton, actionLabel);
        if (outcome.type === 'chat_input') {
            if (isApplication) {
                return {
                    success: true,
                    detail: '投递完成并已进入沟通页；智联已发送默认招呼语和平台简历',
                    mode: 'application_submitted',
                };
            }
            return completeChatGreeting(outcome.element, decision, job, autoMode);
        }
        if (outcome.type === 'dialog') return completeConfirmationDialog(outcome.element, actionButton, decision, job, autoMode, isApplication);
        if (outcome.type === 'success') return {success: true, detail: outcome.detail, mode: isApplication ? 'application_submitted' : 'direct_contact'};
        if (outcome.type === 'unsupported_popup') {
            return {success: false, reason: `点击后出现尚未适配的沟通弹层：${outcome.detail || '未识别文字'}`};
        }
        const diagnostics = contactDiagnostics(actionButton, beforeUrl);
        await logAction({
            action: 'zhaopin_contact_diagnostics',
            decisionId: decision.decisionId,
            company: job.company,
            title: job.title,
            diagnostics,
        });
        const candidateSummary = diagnostics.candidates.map(item => `${item.node}:${item.text}`).join(' | ') || '无';
        const buttonSummary = diagnostics.buttons.map(item => item.text).join('、') || '无';
        return {
            success: false,
            reason: `${outcome.detail}；URL变化：${diagnostics.urlChanged ? '是' : '否'}；候选组件：${candidateSummary}；候选按钮：${buttonSummary}`,
        };
    };

    const find51JobCard = job => {
        const cards = getCards();
        const titleIdentity = normalizeIdentity(job.title);
        const companyIdentity = normalizeIdentity(job.company);
        const externalId = clean(job.externalId).replace(/\.html$/i, '');
        const ranked = cards.map((card, index) => {
            const cardTitle = firstText(card, definition.title);
            const cardCompany = normalizeCompany(firstText(card, definition.company));
            const cardTitleIdentity = normalizeIdentity(cardTitle);
            const cardCompanyIdentity = normalizeIdentity(cardCompany);
            const html = String(card.outerHTML || '');
            let score = 0;
            if (externalId && /^\d{6,12}$/.test(externalId) && html.includes(externalId)) score += 20;
            if (titleIdentity && cardTitleIdentity === titleIdentity) score += 10;
            else if (titleIdentity && cardTitleIdentity
                && (titleIdentity.includes(cardTitleIdentity) || cardTitleIdentity.includes(titleIdentity))) score += 5;
            if (companyIdentity && cardCompanyIdentity === companyIdentity) score += 6;
            else if (companyIdentity && cardCompanyIdentity
                && (companyIdentity.includes(cardCompanyIdentity) || cardCompanyIdentity.includes(companyIdentity))) score += 3;
            if (Number(job.listIndex) === index) score += 1;
            return {card, score, cardTitle};
        }).sort((left, right) => right.score - left.score);
        return ranked[0]?.score >= 10 ? ranked[0].card : null;
    };
    const find51JobApplyButton = card => Array.from(card?.querySelectorAll?.('button,a,[role="button"]') || [])
        .find(element => visible(element) && /^(投递|立即投递|投递简历|申请职位|立即申请)$/.test(clean(element.innerText || element.textContent))) || null;
    const find51JobAppliedText = card => Array.from(card?.querySelectorAll?.('button,a,[role="button"],span') || [])
        .map(element => clean(element.innerText || element.textContent))
        .find(text => /^(已投递|已申请|已投简历)$/.test(text)) || '';
    const job51SuccessText = card => {
        const applied = find51JobAppliedText(card);
        if (applied) return applied;
        return visibleElements([
            '.el-message', '.el-notification', '.el-message-box', '.el-dialog',
            '[class*="toast"]', '[class*="message"]', '[role="alert"]',
        ]).map(element => clean(element.innerText || element.textContent))
            .find(text => /投递成功|申请成功|简历投递成功|已成功投递|已投递/.test(text)) || '';
    };
    const find51JobDialog = () => visibleElements([
        '.el-dialog', '.el-message-box', '[role="dialog"]', '[class*="dialog"]', '[class*="modal"]',
    ]).find(element => /投递|申请|简历|登录|凭证/.test(clean(element.innerText || element.textContent))) || null;
    const waitFor51JobApplicationOutcome = async (card, ignoredDialog = null, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const successText = job51SuccessText(card);
            if (successText) return {type: 'success', detail: successText};
            const dialog = find51JobDialog();
            if (dialog && dialog !== ignoredDialog && !ignoredDialog?.contains?.(dialog)) {
                return {type: 'dialog', element: dialog};
            }
            await sleep(300);
        }
        return {type: 'unknown', detail: '点击投递后未识别到“已申请”、成功提示或确认弹窗'};
    };
    const complete51JobApplicationDialog = async (dialog, card, autoMode, job = null, decision = null) => {
        const dialogText = clean(dialog.innerText || dialog.textContent).slice(0, 800);
        if (/凭证失效|登录(?:已)?失效|登录过期|请重新登录/.test(dialogText)) {
            return {success: false, authExpired: true, retrySafe: true, reason: `前程无忧登录状态已失效：${dialogText}`};
        }
        // 前程无忧主站会把部分校招职位转到应届生求职平台。这里没有完成主站投递，
        // 不能记录成普通失败，也不能占用七天去重；下一次可在正确的平台继续处理。
        if (/应届生|校园招聘|校招|网申|前往应届生|跳转应届生/.test(dialogText)) {
            const forwardButton = findActionByText(/^(立即前往|前往|去应届生平台|继续申请)$/, dialog);
            if (autoMode && forwardButton) {
                await gmSet(CAMPUS_REQUEST_KEY, {
                    job: job || {},
                    decision: decision || {},
                    createdAt: Date.now(),
                });
                forwardButton.click();
            }
            return {
                success: false,
                retrySafe: true,
                campusRedirect: true,
                handedOff: Boolean(autoMode && forwardButton),
                reason: `检测到应届生/校园网申流程，${autoMode && forwardButton ? '已打开前往链接，' : ''}主站未完成投递：${dialogText}`,
            };
        }
        if (/投递成功|申请成功|已成功投递|已投递/.test(dialogText)) {
            return {success: true, detail: dialogText, mode: 'application_submitted'};
        }
        if (/上传|添加附件|选择本地文件/.test(dialogText)) {
            return {success: false, reason: `投递弹窗要求上传本地文件，脚本不会自动选择文件：${dialogText}`};
        }
        if (!/投递|申请|简历/.test(dialogText)) {
            return {success: false, reason: `弹窗用途不明确，已停止：${dialogText}`};
        }
        const confirmButton = findActionByText(/^(确认|确定|立即投递|确认投递|投递|申请|立即申请|使用该简历投递|继续投递|继续)$/, dialog);
        if (!confirmButton) return {success: false, reason: `出现投递弹窗但没有识别到确认按钮：${dialogText}`};
        if (!autoMode && !window.confirm(`前程无忧即将确认投递：\n\n${dialogText}\n\n是否点击“${clean(confirmButton.innerText)}”？`)) {
            return {success: false, cancelled: true, retrySafe: true, reason: '用户取消确认投递'};
        }
        confirmButton.click();
        const outcome = await waitFor51JobApplicationOutcome(card, dialog, 15000);
        return outcome.type === 'success'
            ? {success: true, detail: outcome.detail, mode: 'application_submitted'}
            : {success: false, reason: outcome.detail || '确认后未识别到投递成功状态'};
    };
    const run51JobApplicationWorker = async () => {
        if (platform !== 'job51') return false;
        const request = await gmGet(APPLICATION_REQUEST_KEY);
        if (!detailMatchesRequest(request)) return false;
        await waitForDetail();
        const root = document.body || document.documentElement;
        let result;
        const alreadyApplied = find51JobAppliedText(root);
        if (alreadyApplied) {
            result = {
                success: false,
                safeSkip: true,
                alreadyApplied: true,
                reason: `详情页显示“${alreadyApplied}”，无需重复投递`,
                mode: 'application_already_done',
            };
        } else {
            const button = findActionByText(/^(投递|立即投递|投递简历|申请职位|立即申请)$/, root);
            if (!button) {
                result = {success: false, safeSkip: true, retrySafe: true, reason: '详情页没有找到可用的“投递”按钮'};
            } else {
                button.scrollIntoView({block: 'center'});
                button.click();
                const outcome = await waitFor51JobApplicationOutcome(root);
                if (outcome.type === 'dialog') {
                    result = await complete51JobApplicationDialog(outcome.element, root, true, request, request);
                } else if (outcome.type === 'success') {
                    result = {success: true, detail: outcome.detail, mode: 'application_submitted'};
                } else {
                    result = {success: false, reason: outcome.detail || '详情页点击后未识别到投递结果'};
                }
            }
        }
        await gmSet(APPLICATION_RESPONSE_KEY, {
            requestId: request.id,
            ...result,
            completedAt: new Date().toISOString(),
        });
        await sleep(300);
        window.close();
        return true;
    };
    const execute51JobApplicationInDetailTab = async job => {
        const request = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            platform,
            externalId: job.externalId,
            url: job.url,
            title: job.title,
            company: job.company,
            createdAt: Date.now(),
        };
        await gmDelete(APPLICATION_RESPONSE_KEY);
        await gmSet(APPLICATION_REQUEST_KEY, request);
        const applicationTab = GM_openInTab(job.url, {active: false, insert: true, setParent: true});
        const started = Date.now();
        try {
            while (Date.now() - started < 35000) {
                await waitIfPaused();
                const response = await gmGet(APPLICATION_RESPONSE_KEY);
                if (response?.requestId === request.id) return response;
                await sleep(400);
            }
            return {success: false, reason: '岗位详情页投递执行超时，未确认是否成功'};
        } finally {
            if (applicationTab?.close) applicationTab.close();
            await gmDelete(APPLICATION_REQUEST_KEY);
            await gmDelete(APPLICATION_RESPONSE_KEY);
        }
    };
    const execute51JobApplication = async (job, decision, autoMode = false, sourceCard = null) => {
        if (job.externalCampusUrl) {
            return {
                success: false,
                safeSkip: true,
                retrySafe: true,
                reason: '该岗位详情属于校招/应届生子平台，本次只评分不自动跳转或投递',
            };
        }
        const card = sourceCard || find51JobCard(job);
        if (card) {
            card.scrollIntoView({block: 'center'});
            await sleep(180);
            const alreadyApplied = find51JobAppliedText(card);
            if (alreadyApplied) {
                return {success: false, safeSkip: true, alreadyApplied: true, reason: `页面显示“${alreadyApplied}”，无需重复投递`, mode: 'application_already_done'};
            }
        }
        const button = card ? find51JobApplyButton(card) : null;
        if (!button && !job.url) return {success: false, safeSkip: true, retrySafe: true, reason: '没有定位到岗位卡片，也没有可用的岗位详情地址'};
        const actionLabel = button ? clean(button.innerText || button.textContent) : '详情页投递';
        if (!autoMode && !window.confirm(
            `即将进行一次前程无忧真实投递：\n\n岗位：${job.title}\n公司：${job.company}\n匹配度：${decision.score}\n按钮：${actionLabel}\n\n是否继续？`
        )) return {success: false, cancelled: true, retrySafe: true, reason: '用户取消投递'};
        const confirmedPlan = await requestLocal('/api/execution/plan', 'POST', {
            platform, job, decision, confirmedByUser: !autoMode,
        });
        if (!confirmedPlan.allowExecute) {
            return {success: false, retrySafe: true, reason: `后端安全锁未放行：${confirmedPlan.blockedBy || 'unknown'}`};
        }
        await logAction({
            action: 'job51_application_clicking', decisionId: decision.decisionId,
            company: job.company, title: job.title, externalId: job.externalId, actionLabel,
        });
        await rememberLiveAttempt(job, decision, actionLabel);
        if (!button) {
            await addLog(`当前列表没有对应卡片，改从岗位详情页执行投递：[${job.company}] ${job.title}`);
            return execute51JobApplicationInDetailTab(job);
        }
        button.click();
        const outcome = await waitFor51JobApplicationOutcome(card);
        if (outcome.type === 'dialog') return complete51JobApplicationDialog(outcome.element, card, autoMode, job, decision);
        if (outcome.type === 'success') {
            return {success: true, detail: outcome.detail, mode: 'application_submitted'};
        }
        return {success: false, reason: outcome.detail};
    };
    const runCampusApplicationWorker = async () => {
        if (platform !== 'job51_campus') return false;
        const request = await gmGet(CAMPUS_REQUEST_KEY);
        if (!request?.createdAt || Date.now() - Number(request.createdAt) > 10 * 60 * 1000) return false;
        const job = request.job || {};
        const decision = request.decision || {};
        const text = clean(document.body?.innerText || '').slice(0, 1200);
        await sleep(1200);
        let result;
        if (/登录|注册|验证码|安全验证/.test(text) && !findActionByText(/^(立即投递|立即申请|投递简历|申请职位|申请)$/)) {
            result = {success: false, manualRequired: true, reason: `校招平台需要登录或验证：${text.slice(0, 240)}`};
        } else {
            const already = Array.from(document.querySelectorAll('button,a,[role="button"],span'))
                .map(element => clean(element.innerText || element.textContent))
                .find(value => /^(已投递|已申请|已报名)$/.test(value));
            if (already) {
                result = {success: false, alreadyApplied: true, safeSkip: true, reason: `校招页面显示“${already}”`};
            } else {
                const apply = findActionByText(/^(立即投递|立即申请|投递简历|申请职位|申请)$/);
                if (!apply) {
                    result = {success: false, manualRequired: true, reason: '校招页面未识别到明确的“立即投递/立即申请”按钮，已停止'};
                } else {
                    apply.click();
                    await sleep(900);
                    const dialog = find51JobDialog();
                    if (dialog) {
                        const dialogText = clean(dialog.innerText || dialog.textContent).slice(0, 800);
                        if (/登录|注册|验证码|安全验证|填写|上传|选择简历/.test(dialogText)) {
                            result = {success: false, manualRequired: true, reason: `校招投递需要人工确认：${dialogText}`};
                        } else {
                            const confirm = findActionByText(/^(确认|确定|立即投递|立即申请|继续|提交)$/, dialog);
                            if (confirm) confirm.click();
                            await sleep(1200);
                            result = /投递成功|申请成功|报名成功|已投递|已申请/.test(clean(document.body?.innerText || ''))
                                ? {success: true, mode: 'campus_application_submitted', detail: '应届生平台已显示投递成功'}
                                : {success: false, manualRequired: true, reason: '校招确认后未识别到成功状态'};
                        }
                    } else {
                        await sleep(1200);
                        result = /投递成功|申请成功|报名成功|已投递|已申请/.test(clean(document.body?.innerText || ''))
                            ? {success: true, mode: 'campus_application_submitted', detail: '应届生平台已显示投递成功'}
                            : {success: false, manualRequired: true, reason: '点击校招投递后未识别到成功状态'};
                    }
                }
            }
        }
        await logAction({
            action: result.success ? 'job51_campus_application_sent'
                : result.alreadyApplied ? 'job51_campus_already_applied'
                    : result.manualRequired ? 'job51_campus_manual_required' : 'job51_campus_application_failed',
            decisionId: decision.decisionId,
            company: job.company || null,
            title: job.title || null,
            score: decision.score,
            reason: result.reason || null,
            detail: result.detail || null,
        });
        await gmDelete(CAMPUS_REQUEST_KEY);
        return true;
    };

    const finishRun = async (state, message, config) => {
        const done = {...state, active: false, paused: false, phase: 'done', finishedAt: Date.now()};
        await saveState(done);
        setRunButton(done);
        await addLog(message);
        await addLog(config?.executionMode === 'test'
            ? '发送安全锁：未发送任何消息或简历'
            : Number(state.liveSent || 0) > 0
                ? `本次已自动${platform === 'job51' ? '投递' : '沟通'} ${state.liveSent} 个岗位`
                : `本次正式扫描未执行真实${platform === 'job51' ? '投递' : '沟通'}`);
    };
    const recordLiveAttemptResult = async result => {
        if (result.retrySafe) {
            await forgetLiveAttempt({company: result.company, title: result.title});
        }
        const isJob51 = platform === 'job51';
        const action = isJob51
            ? result.campusRedirect ? 'job51_campus_redirect_skipped'
                : result.alreadyApplied ? 'job51_already_applied'
                : result.success ? 'job51_application_sent'
                : result.retrySafe ? 'job51_application_not_sent'
                    : result.cancelled ? 'job51_application_cancelled' : 'job51_application_failed'
            : result.success
                ? /^application_/.test(result.mode || '') ? 'zhaopin_application_sent' : 'zhaopin_greeting_sent'
                : result.retrySafe ? 'zhaopin_contact_not_sent'
                    : result.cancelled ? 'zhaopin_greeting_cancelled' : 'zhaopin_greeting_failed';
        await logAction({
            action,
            decisionId: result.decisionId,
            company: result.company,
            title: result.title,
            score: result.score,
            detail: result.detail || null,
            reason: result.reason || null,
            mode: result.mode || null,
        });
    };
    const finishLiveAttempt = async (state, result) => {
        await recordLiveAttemptResult(result);
        const stopped = {
            ...state,
            active: false,
            paused: false,
            phase: result.success ? 'live_action_done' : result.authExpired ? 'login_required' : 'live_action_stopped',
            finishedAt: Date.now(),
        };
        await saveState(stopped);
        setRunButton(stopped);
        if (result.success) {
            await addLog(`${/^application_/.test(result.mode || '') ? '在线简历已投递' : '真实沟通已执行'}：${result.detail || '页面已显示成功状态'}`);
        } else if (result.authExpired) {
            await addLog(`${definition.name}登录已失效：本次确认未发送，请重新登录后再开始`);
        } else if (result.cancelled) {
            await addLog(`本次真实操作已取消：${result.reason}`);
        } else if (result.campusRedirect) {
            await addLog(`检测到校招网申：主站未完成投递，请在应届生平台手动申请；本次未占用七天去重`);
        } else {
            await addLog(`本次真实操作未完成：${result.reason}`);
        }
        await addLog('单岗位安全限制：程序已自动停止，不会继续处理其他岗位');
    };
    const verify51JobSearchPage = state => {
        if (platform !== 'job51') return;
        const pageUrl = new URL(location.href);
        const pageKeyword = clean(pageUrl.searchParams.get('keyword'));
        const expectedKeyword = clean(state.currentKeyword);
        const correctPath = pageUrl.hostname === 'we.51job.com' && pageUrl.pathname === '/pc/search';
        const correctKeyword = normalizeIdentity(pageKeyword) === normalizeIdentity(expectedKeyword);
        if (!correctPath || !correctKeyword) {
            throw new Error(
                `当前页面未进入目标搜索结果页（地址：${pageUrl.hostname}${pageUrl.pathname || '/'}，`
                + `页面关键词：${pageKeyword || '无'}，目标关键词：${expectedKeyword || '无'}），`
                + '已停止以避免扫描首页或上一轮推荐岗位',
            );
        }
    };
    const processCurrentKeyword = async (config, state, keywords, maxJobs) => {
        // 搜索可能打开/切换页面；先检查任务所有权，避免旧页面和新页面各输出一次倒计时。
        state = await waitIfPaused();
        verify51JobSearchPage(state);
        if (platform === 'job51') await addLog('已确认目标搜索结果页与本轮关键词一致');
        const waitLeft = Math.max(0, MANUAL_FILTER_WAIT_MS - (Date.now() - Number(state.searchStartedAt || 0)));
        if (waitLeft > 0) {
            await addLog(`请在 ${(waitLeft / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
            const deadline = Date.now() + waitLeft;
            while (Date.now() < deadline) {
                await waitIfPaused();
                await sleep(Math.min(400, deadline - Date.now()));
            }
        }
        await addLog(`开始按当前筛选条件扫描岗位（关键词：${state.currentKeyword}）`);
        const diagnostics = collectListDiagnostics();
        await addLog(platform === 'zhaopin'
            ? `列表诊断：传统职位链接 ${diagnostics.visibleJobLinkCount} 个；新版岗位主要使用无链接卡片`
            : `列表诊断：可见职位链接 ${diagnostics.visibleJobLinkCount} 个`);
        await logAction({action: 'platform_dom_diagnostics', diagnostics});
        const structureDiagnostics = collectStructureDiagnostics();
        await logAction({action: 'platform_structure_diagnostics', diagnostics: structureDiagnostics});
        await addLog(`结构诊断已记录：重复候选结构 ${structureDiagnostics.repeatedStructures.length} 组，相关资源 ${structureDiagnostics.resourcePaths.length} 条`);
        let apiJobs = [];
        if (platform === 'job51') {
            try {
                apiJobs = await fetch51JobSearchApi(state.currentKeyword, maxJobs);
                if (apiJobs.length) {
                    await addLog(`前程无忧搜索接口已返回 ${apiJobs.length} 个岗位，用于补充页面卡片的岗位 ID 和完整 JD`);
                    await logAction({
                        action: 'job51_search_api_succeeded',
                        keyword: state.currentKeyword,
                        count: apiJobs.length,
                        fullDetailCount: apiJobs.filter(job => job.detailSource === 'search_api').length,
                    });
                }
            } catch (error) {
                await addLog(`前程无忧搜索接口暂不可用，自动回退页面卡片：${error.message}`);
                await logAction({action: 'job51_search_api_failed', keyword: state.currentKeyword, reason: error.message});
            }
        }
        // 前程无忧真实投递必须以当前页面的 DOM 卡片为准；搜索接口只补充完整 JD。
        // 这样评分通过后可以直接点击同一张卡片的投递按钮，不依赖接口结果顺序。
        const cards = await loadCards(Math.min(maxJobs, 100));
        if (!apiJobs.length && !cards.length) {
            await addLog(`页面诊断：${pageDiagnostics()}`);
            throw new Error('没有识别到岗位列表；请确认已经登录，且当前页面确实显示了岗位卡片');
        }
        if (cards.length) {
            await addLog(platform === 'zhaopin' && Number(state.keywordIndex || 0) > 0
                ? `岗位列表已识别 ${cards.length} 条（可能包含前轮保留卡片，处理时自动去重）`
                : `岗位列表已识别 ${cards.length} 条`);
        }
        const sources = cards.length
            ? cards.map((card, index) => ({card, cardJob: null, index}))
            : apiJobs.map(cardJob => ({card: null, cardJob}));
        const roundLimit = maxJobs;
        let current = await readState();
        const keywordSeenKey = String(Number(current.keywordIndex || 0));
        const seenByKeyword = current.seenByKeyword && typeof current.seenByKeyword === 'object'
            ? current.seenByKeyword
            : {};
        // 每个搜索词单独去重，保证“每词查看 10 个”确实能分别达到 10 个。
        // 真正发送时仍由七天去重和真实点击记录阻止跨关键词重复联系。
        const seen = new Set(Array.isArray(seenByKeyword[keywordSeenKey]) ? seenByKeyword[keywordSeenKey] : []);
        const withCurrentKeywordSeen = value => ({
            ...value,
            seenByKeyword: {
                ...(value.seenByKeyword || {}),
                [keywordSeenKey]: Array.from(seen).slice(-1000),
            },
        });
        let roundProcessed = 0;
        for (const source of sources) {
            current = await waitIfPaused();
            if (keywordRemaining(current, maxJobs) <= 0 || roundProcessed >= roundLimit) break;
            const card = source.card;
            let cardJob = source.cardJob || await extractCard(card, source.index);
            if (platform === 'job51' && card && apiJobs.length) {
                const titleIdentity = normalizeIdentity(cardJob.title);
                const companyIdentity = normalizeIdentity(cardJob.company);
                const apiMatch = apiJobs.find(item => {
                    const apiTitle = normalizeIdentity(item.title);
                    const apiCompany = normalizeIdentity(item.company);
                    const titleMatched = titleIdentity && apiTitle && titleIdentity === apiTitle;
                    const companyMatched = !companyIdentity || !apiCompany
                        || companyIdentity === apiCompany
                        || companyIdentity.includes(apiCompany)
                        || apiCompany.includes(companyIdentity);
                    return titleMatched && companyMatched;
                });
                if (apiMatch) {
                    cardJob = {
                        ...cardJob,
                        externalId: apiMatch.externalId || cardJob.externalId,
                        url: apiMatch.url || cardJob.url,
                        company: cardJob.company || apiMatch.company,
                        salary: cardJob.salary || apiMatch.salary,
                        detail: apiMatch.detail || cardJob.detail,
                        detailSource: apiMatch.detailSource || cardJob.detailSource,
                        detailLength: apiMatch.detailLength || clean(cardJob.detail).length,
                    };
                }
            }
            const key = cardJob.url || `${cardJob.title}|${cardJob.company}`;
            if (!cardJob.title || seen.has(key)) continue;
            seen.add(key);
            await addLog(`| 当前搜索词: ${maxJobs - keywordRemaining(current, maxJobs) + 1}/${maxJobs} | 正在获取职位详情 |`);
            if (platform === 'job51') {
                await addLog(cardJob.externalCampusUrl
                    ? '检测到校招/应届生子平台链接，未打开外部详情页'
                    : cardJob.detailSource === 'search_api'
                    ? '已从前程无忧搜索接口读取岗位 ID 和完整 JD'
                    : cardJob.detailSource === 'search_api_summary'
                        ? '已从搜索接口读取岗位 ID，正在补充完整 JD'
                        : cardJob.url
                            ? '已捕获前程无忧真实岗位地址，正在读取完整 JD'
                            : '未捕获到真实岗位地址，本岗位暂用卡片摘要评分');
            }
            const job = cardJob.detailSource === 'search_api'
                ? cardJob
                : await fetchDetail(cardJob, card);
            if (platform === 'job51' && cardJob.url && !['detail_page', 'search_api'].includes(job.detailSource)) {
                await addLog(`岗位 [${cardJob.title}] 详情补充未完成，本次使用现有摘要评分`);
            }
            await addLog(job.company ? `已识别公司：[${job.company}]` : `岗位 [${job.title}] 未识别到公司名称`);
            if (job.detailSource === 'job_card_inline_timeout') {
                await addLog(`岗位 [${job.title}] 右侧详情加载超时，本次只记录失败，不使用卡片摘要评分`);
                await logAction({
                    action: 'platform_job_detail_failed',
                    company: job.company || null,
                    title: job.title,
                    salary: job.salary,
                    externalId: job.externalId,
                    reason: 'inline_detail_timeout',
                    observedTitle: job.observedTitle || null,
                    observedCompany: job.observedCompany || null,
                    observedDetailLength: job.observedDetailLength || 0,
                    cardStructure: job.cardStructure || [],
                });
                roundProcessed += 1;
                current = withCurrentKeywordSeen(recordKeywordView(current));
                await saveState(current);
                continue;
            }
            const decision = await requestLocal('/get-job-score', 'POST', job);
            const plan = await requestLocal('/api/execution/plan', 'POST', {platform, job, decision});
            if (config.executionMode === 'test' && plan.allowExecute) {
                throw new Error('安全锁异常：测试执行器收到 allowExecute=true，已立即停止');
            }
            const planned = (plan.plannedActions || []).map(item => item.label || item.type).join('、') || '无';
            const blockedLabels = {
                test_mode: '测试模式', adapter_not_live: '平台未开放正式执行',
                platform_disabled: '平台未启用', screen_only: '只筛选模式',
                duplicate_contact_attempt: '曾点击过真实沟通',
                company_missing: '公司未识别', below_threshold: '低于阈值',
            };
            const planStatus = config.executionMode === 'test'
                ? '已拦截'
                : plan.allowExecute ? '允许自动发送'
                : `未执行（${blockedLabels[plan.blockedBy] || plan.blockedBy || '未知原因'}）`;
            await addLog(`职位 [${job.title}] 匹配度：${decision.score}｜预计动作：${planned}｜${planStatus}`);
            await logAction({
                action: config.executionMode === 'test' ? 'platform_test_planned' : 'platform_live_planned',
                decisionId: decision.decisionId,
                company: job.company || null,
                clientCompany: job.clientCompany || null,
                title: job.title,
                salary: job.salary,
                score: decision.score,
                externalId: job.externalId,
                url: job.url,
                detailSource: job.detailSource,
                detailLength: Number(job.detailLength || clean(job.detail).length),
                plannedActions: plan.plannedActions,
                blockedBy: plan.blockedBy,
            });
            roundProcessed += 1;
            current = withCurrentKeywordSeen(recordKeywordView(current));
            await saveState(current);
            if (
                config.executionMode === 'live'
                && ['zhaopin', 'job51', 'job51_campus'].includes(platform)
                && plan.allowExecute
            ) {
                const locallyAttempted = await hasLiveAttempt(job);
                if (locallyAttempted && plan.contactRetrySafe) {
                    await forgetLiveAttempt(job);
                    await addLog(`岗位 [${job.title}] 上次因登录失效确认未发送，已允许重试`);
                } else if (locallyAttempted) {
                    await addLog(platform === 'job51'
                        ? `岗位 [${job.title}] 曾点击过真实投递按钮，为避免重复投递已跳过`
                        : `岗位 [${job.title}] 曾点击过真实沟通按钮，为避免重复联系已跳过`);
                    await logAction({
                        action: platform === 'job51' ? 'job51_duplicate_attempt_blocked' : 'zhaopin_duplicate_attempt_blocked',
                        decisionId: decision.decisionId,
                        company: job.company,
                        title: job.title,
                    });
                    continue;
                }
                const autoMode = config.deliveryMode === 'auto';
                const result = ['job51', 'job51_campus'].includes(platform)
                    ? await execute51JobApplication(job, decision, autoMode, card)
                    : await executeZhaopinGreeting(job, decision, autoMode);
                const completeResult = {
                    ...result,
                    decisionId: decision.decisionId,
                    company: job.company,
                    title: job.title,
                    score: decision.score,
                };
                if (autoMode && result.success) {
                    await recordLiveAttemptResult(completeResult);
                    current = {...current, liveSent: Number(current.liveSent || 0) + 1};
                    await saveState(current);
                    await addLog(`${/^application_/.test(result.mode || '') ? '自动投递成功' : '自动沟通成功'}：[${job.company}] ${job.title}｜${result.detail || '已完成真实操作'}`);
                    const nextDelay = 3500 + Math.floor(Math.random() * 3000);
                    await addLog(`将在 ${(nextDelay / 1000).toFixed(1)} 秒后继续，避免连续快速操作`);
                    await sleep(nextDelay);
                    continue;
                }
                if (autoMode && result.safeSkip) {
                    await recordLiveAttemptResult(completeResult);
                    await addLog(`已安全跳过：[${job.company}] ${job.title}｜${result.reason}`);
                    continue;
                }
                await finishLiveAttempt(current, completeResult);
                return;
            }
        }
        current = await readState();
        if (keywordRemaining(current, maxJobs) > 0 && await advanceResultsPage(current)) return;
        if (!roundProcessed && !Number(current.pageAdvanceCount || 0)) {
            await addLog(`页面诊断：${pageDiagnostics()}`);
            throw new Error('找到了疑似列表元素，但没有提取到有效岗位名称和链接');
        }
        const nextIndex = Number(current.keywordIndex || 0) + 1;
        if (nextIndex >= keywords.length) {
            await finishRun(current, `全部关键词${config.executionMode === 'test' ? '测试' : '正式扫描'}完成：已检查 ${current.totalProcessed || 0} 个岗位`, config);
            return;
        }
        const next = {...current, phase: 'search', keywordIndex: nextIndex, pageAdvanceCount: 0};
        await saveState(next);
        await divider();
        await addLog('当前关键词处理完成，准备切换下一个关键词');
        await sleep(1200);
        // 等当前一轮释放运行锁后，再进入下一关键词。
        setTimeout(() => runEngine(), 0);
    };

    const runEngine = async () => {
        if (running) return;
        running = true;
        try {
            let state = await readState();
            if (!state.active || state.paused) return;
            const config = await requestLocal('/client-config');
            await syncLiveAttemptReset();
            if (!['test', 'live'].includes(config.executionMode)) throw new Error('控制台运行模式无效');
            if (config.executionMode === 'live' && !['zhaopin', 'job51', 'job51_campus'].includes(platform)) {
                throw new Error('当前平台尚未开放真实操作，请切换回“测试模式”');
            }
            const configuredPlatform = platform === 'job51_campus' ? 'job51' : platform;
            if (config.executionMode === 'live' && !config.platforms?.[configuredPlatform]?.enabled) {
                throw new Error(`本地控制台尚未启用${definition.name}，请先打开平台开关`);
            }
            if (!state.modeAnnounced) {
                await addLog(config.executionMode === 'test'
                    ? '运行模式：只测试，不发送'
                    : ['job51', 'job51_campus'].includes(platform)
                        ? config.deliveryMode === 'auto'
                            ? '运行模式：前程无忧正式模式｜达到阈值后投递平台简历｜七天去重｜不上传附件'
                            : '运行模式：前程无忧正式模式｜筛选不发送'
                        : config.deliveryMode === 'auto'
                            ? '运行模式：智联正式模式｜达到阈值后投递在线简历并建立沟通｜去重｜不上传附件'
                            : '运行模式：智联正式模式｜筛选不发送');
                state = {...state, modeAnnounced: true};
                await saveState(state);
            }
            const configuredKeywords = Array.isArray(config.tags) ? config.tags.map(clean).filter(Boolean) : [];
            const keywordMap = new Map();
            for (const keyword of configuredKeywords) {
                const identity = normalizeIdentity(keyword);
                if (identity && !keywordMap.has(identity)) keywordMap.set(identity, keyword);
            }
            const keywords = Array.from(keywordMap.values());
            if (!keywords.length) throw new Error('控制台没有配置搜索关键词');
            if (!state.keywordsAnnounced) {
                const mergedCount = configuredKeywords.length - keywords.length;
                await addLog(`本次共 ${keywords.length} 轮有效搜索词${mergedCount ? `（已合并 ${mergedCount} 个仅空格或标点不同的重复词）` : ''}`);
                state = {...state, keywordsAnnounced: true};
                await saveState(state);
            }
            const configuredMax = Number(config.frontend?.maxJobsPerKeyword || 0);
            const maxJobs = configuredMax > 0 ? configuredMax : DEFAULT_MAX_JOBS_PER_KEYWORD;
            if (state.phase === 'search') {
                const keyword = keywords[Math.min(Number(state.keywordIndex || 0), keywords.length - 1)];
                await divider();
                await addLog(`开始第 ${Number(state.keywordIndex || 0) + 1} 轮`);
                state = await applySearch(keyword, state);
            }
            if (state.phase === 'collect') {
                await processCurrentKeyword(config, state, keywords, maxJobs);
            }
        } catch (error) {
            if (!['运行已停止', '运行已由新页面接管'].includes(error.message)) {
                await addLog(`运行停止：${error.message}`);
                await logAction({action: 'platform_test_failed', reason: error.message, url: location.href});
            }
            if (error.message === '运行已由新页面接管') return;
            const state = await readState();
            const stopped = {...state, active: false, paused: false, phase: 'failed', reason: error.message};
            await saveState(stopped);
            setRunButton(stopped);
        } finally {
            running = false;
        }
    };

    const handleRunClick = async () => {
        let state = await readState();
        if (state.active && !state.paused) {
            state = {...state, paused: true};
            await saveState(state);
            setRunButton(state);
            await addLog('暂停中...');
            return;
        }
        if (state.active && state.paused) {
            state = {...state, paused: false};
            await saveState(state);
            setRunButton(state);
            await addLog('继续运行');
            await runEngine();
            return;
        }
        state = {
            active: true,
            paused: false,
            platform,
            phase: 'search',
            keywordIndex: 0,
            totalProcessed: 0,
            keywordProcessed: {},
            pageAdvanceCount: 0,
            liveSent: 0,
            seenByKeyword: {},
            ownerId: INSTANCE_ID,
            startedAt: Date.now(),
            modeAnnounced: false,
            keywordsAnnounced: false,
        };
        await saveState(state);
        setRunButton(state);
        await addLog('--程序启动--');
        await addLog(`平台：${definition.name}｜脚本版本：${SCRIPT_VERSION}｜${authState()}｜正在读取控制台运行模式`);
        await runEngine();
    };

    (async () => {
        if (await runCampusApplicationWorker()) return;
        if (await run51JobApplicationWorker()) return;
        if (await runDetailWorker()) return;
        ui = createPanel();
        renderLogs(await gmGet(LOG_KEY, []));
        ui.clearBtn.addEventListener('click', clearLogs);
        ui.runBtn.addEventListener('click', handleRunClick);
        let state = await readState();
        // 前程无忧提交搜索时可能整页刷新。只要刷新发生在脚本刚提交搜索后的短窗口内，
        // 就视为正常任务跳转并续跑；其他 reload 才视为用户手动刷新。
        const currentUrlKeyword = clean(new URL(location.href).searchParams.get('keyword'));
        const expected51JobNavigation = platform === 'job51'
            && state.active
            && state.phase === 'collect'
            && state.pendingNavigation
            && normalizeIdentity(currentUrlKeyword) === normalizeIdentity(state.currentKeyword);
        const recentScriptSearch = state.active
            && state.phase === 'collect'
            && Date.now() - Number(state.searchStartedAt || 0) < 20000;
        if (state.active && navigationType() === 'reload' && !recentScriptSearch && !expected51JobNavigation) {
            state = {...state, active: false, paused: false, phase: 'refreshed', ownerId: INSTANCE_ID};
            await saveState(state);
            await addLog('检测到手动刷新，已结束旧任务；点击“开始”可重新运行');
        }
        if (expected51JobNavigation) {
            state = {...state, pendingNavigation: false, navigationTarget: ''};
            await saveState(state);
        }
        const ownedState = state.active ? await claimState(state) : state;
        setRunButton(ownedState);
        if (ownedState.active && !ownedState.paused) {
            await addLog('页面已加载，继续当前任务');
            await runEngine();
        } else if (!ownedState.active && !(await gmGet(LOG_KEY, [])).length) {
            await addLog(`${definition.name}：等待开始，运行模式以本地控制台设置为准`);
        }
    })();
})();
