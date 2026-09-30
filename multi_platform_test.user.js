// ==UserScript==
// @name         goodJobs · 智联招聘/前程无忧
// @namespace    https://github.com/keyuanrong/resume-agent
// @version      2026-09-30
// @description  与 Boss 相同的控制面板；支持筛选不发送和智联自动沟通
// @match        https://www.zhaopin.com/*
// @match        https://sou.zhaopin.com/*
// @match        https://jobs.zhaopin.com/*
// @match        https://www.51job.com/*
// @match        https://we.51job.com/*
// @match        https://jobs.51job.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @connect      127.0.0.1
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

    const SERVER = 'http://127.0.0.1:8000';
    const DETAIL_REQUEST_KEY = 'resumeAgent:platformTest:detailRequest';
    const DETAIL_RESPONSE_KEY = 'resumeAgent:platformTest:detailResponse';
    const RUN_STATE_KEY = 'resumeAgent:platformTest:runState';
    const LOG_KEY_PREFIX = 'resumeAgent:platformTest:logs:';
    const DEFAULT_MAX_JOBS_PER_KEYWORD = 20;
    const MANUAL_FILTER_WAIT_MS = 10000;
    const MAX_LOG_LINES = 250;
    const INSTANCE_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const platform = location.hostname.includes('zhaopin.com') ? 'zhaopin' : 'job51';
    const LIVE_ATTEMPTS_KEY = `resumeAgent:liveAttempts:${platform}`;
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
            link: ['a[href*="jobs.51job.com/"]:not([href*="/all/co"])', '.jname a'],
            searchInputs: ['input[placeholder*="职位"]', 'input[placeholder*="关键字"]', 'input[placeholder*="搜索"]', '#keywordInput'],
            searchButtons: ['button[class*="search"]', '[class*="search-btn"]', '.search_button'],
            loginMarkers: ['[class*="user-name"]', '[class*="avatar"]', 'a[href*="resume"]'],
            loggedOutMarkers: ['a[href*="login"]', '[class*="login"]'],
            detailTitle: ['h1', '.cn h1', '.jname', '[class*="job-name"]'],
            detailCompany: ['.cname', '.com_name', '.cn p.cname', 'a[href*=".51job.com"][class*="company"]'],
            detailSalary: ['.sal', '.cn strong', '[class*="salary"]'],
            detailBody: ['.job_msg', '.bmsg.job_msg', '[class*="job-detail"]', '[class*="description"]'],
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
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const parsed = JSON.parse(script.textContent || '{}');
                const values = Array.isArray(parsed) ? parsed : [parsed];
                const job = values.find(item => item?.['@type'] === 'JobPosting') || values[0];
                if (job) return job;
            } catch (error) {
                // 非标准 JSON-LD 继续使用 DOM 兜底。
            }
        }
        return {};
    };
    const detailBodyText = () => {
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
    const normalizeIdentity = value => clean(value).toLowerCase().replace(/[\s（）()【】\[\]·•…⋯，,。.!！?？/\\_-]/g, '');
    const liveAttemptKey = job => `${normalizeIdentity(job?.company)}|${normalizeIdentity(job?.title)}`;
    const hasLiveAttempt = async job => {
        const attempts = await gmGet(LIVE_ATTEMPTS_KEY, []);
        return Array.isArray(attempts) && attempts.some(item => item?.key === liveAttemptKey(job));
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
        const next = [record, ...(Array.isArray(attempts) ? attempts : []).filter(item => item?.key !== record.key)].slice(0, 500);
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
        const body = detailBodyText() || clean(structured?.description);
        return {
            requestId: request.id,
            platform,
            externalId: request.externalId,
            url: location.href,
            title: firstText(document, definition.detailTitle) || clean(structured?.title),
            company: normalizeCompany(firstText(document, definition.detailCompany) || structuredCompany),
            salary: firstText(document, definition.detailSalary) || clean(structured?.baseSalary?.value),
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
        const button = firstElement(document, definition.searchButtons, true) || findTextButton('搜索');
        if (!button) throw new Error('没有找到搜索按钮');
        const next = {...state, phase: 'collect', currentKeyword: keyword, searchStartedAt: Date.now()};
        await saveState(next);
        await addLog(`本轮搜索关键词：${keyword}`);
        button.click();
        await sleep(3500);
        return next;
    };
    const fallbackCardsFromJobLinks = () => {
        const selectors = platform === 'zhaopin'
            ? 'a[href*="jobdetail"],a[href*="jobs.zhaopin.com"],a[href*="/job/"]'
            : 'a[href*="jobs.51job.com/"]:not([href*="/all/co"])';
        const links = Array.from(document.querySelectorAll(selectors)).filter(visible);
        const cards = [];
        const seenHrefs = new Set();
        for (const link of links) {
            const href = link.href || '';
            if (!href || seenHrefs.has(href)) continue;
            seenHrefs.add(href);
            // 链接本身就是可靠的最小岗位单元；公司等信息可由详情页补齐。
            cards.push(link);
        }
        return cards;
    };
    function getCards() {
        let best = [];
        for (const selector of definition.cards) {
            const cards = Array.from(document.querySelectorAll(selector)).filter(card => (
                visible(card) && (firstHref(card, definition.link) || firstText(card, definition.title))
            ));
            if (cards.length > best.length) best = cards;
        }
        const linkCards = fallbackCardsFromJobLinks();
        return linkCards.length > best.length ? linkCards : best;
    }
    const elementSignature = element => {
        if (!element) return '';
        const classes = String(element.className || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes ? `.${classes}` : ''}`;
    };
    const collectListDiagnostics = () => {
        const linkSelector = platform === 'zhaopin'
            ? 'a[href*="jobdetail"],a[href*="jobs.zhaopin.com"],a[href*="/job/"]'
            : 'a[href*="jobs.51job.com/"]';
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
            : 'a[href*="jobs.51job.com/"]';
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
    const extractCard = (card, index) => {
        const url = firstHref(card, definition.link);
        const title = firstText(card, definition.title);
        const company = normalizeCompany(firstText(card, definition.company));
        const salary = firstText(card, definition.salary);
        let externalId = `${platform}-${index}`;
        try { externalId = new URL(url).pathname.split('/').filter(Boolean).pop() || externalId; } catch (error) {}
        return {platform, externalId, url, title, company, salary, detail: clean(card.innerText || card.textContent), detailSource: 'job_card'};
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
                        salary: firstText(document, definition.detailSalary) || cardJob.salary,
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
        const request = {id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, platform, externalId: cardJob.externalId, url: cardJob.url, createdAt: Date.now()};
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
                        title: response.title || cardJob.title,
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
            '.job-detail-chat__btn', '.job-detail-summary__apply button',
            '.job-detail-summary__apply', '.job-apply-button button', '.job-apply-button',
        ];
        const pattern = /立即沟通|马上沟通|发起沟通|申请职位|立即申请|投递简历|立即投递/;
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
        const applySuccess = visibleElements(['.a-job-apply-success-message-panel'])[0];
        if (applySuccess) return clean(applySuccess.innerText || '投递成功');
        const selectors = ['.a-toast__content', '.ivu-message-notice-content', '[class*="toast"]', '[class*="message"]'];
        return visibleElements(selectors).map(element => clean(element.innerText || element.textContent))
            .find(text => /沟通成功|发送成功|招呼已发送|投递成功|投递完成|申请成功|已投递|已申请/.test(text)) || '';
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
            if (currentText !== beforeText && /已沟通|继续沟通|已投递|已申请|查看沟通/.test(currentText)) {
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
    const completeConfirmationDialog = async (dialog, button, decision, job, autoMode = false) => {
        const dialogText = clean(dialog.innerText || dialog.textContent).slice(0, 500);
        if (/凭证失效|登录(?:已)?失效|登录过期|请重新登录/.test(dialogText)) {
            return {
                success: false,
                authExpired: true,
                retrySafe: true,
                reason: `智联登录状态已失效，本次未发送：${dialogText}`,
            };
        }
        const confirmButton = findActionByText(/^(确认|确定|投递|确定投递|确认投递|立即投递|确认申请|发送|使用该简历投递|继续投递)$/, dialog);
        if (!confirmButton) return {success: false, reason: `出现弹窗但没有识别到确认按钮：${dialogText}`};
        const confirmed = autoMode || window.confirm(`智联招聘出现二次确认弹窗：\n\n${dialogText}\n\n是否点击“${clean(confirmButton.innerText)}”？`);
        if (!confirmed) return {success: false, cancelled: true, reason: '用户取消二次确认'};
        const beforeText = clean(button?.innerText || button?.textContent);
        confirmButton.click();
        const outcome = await waitForContactOutcome(button, beforeText, 15000, dialog);
        if (outcome.type === 'chat_input') return completeChatGreeting(outcome.element, decision, job, autoMode);
        return outcome.type === 'success'
            ? {success: true, detail: outcome.detail, mode: 'confirmed_application'}
            : {success: false, reason: outcome.detail || '确认后未识别到成功状态'};
    };
    const executeZhaopinGreeting = async (job, decision, autoMode = false) => {
        const actionButton = findZhaopinContactAction();
        if (!actionButton) return {success: false, reason: '没有识别到“立即沟通/申请职位”按钮'};
        const actionLabel = clean(actionButton.innerText || actionButton.textContent);
        const confirmed = autoMode || window.confirm(
            `即将进行一次真实操作：\n\n岗位：${job.title}\n公司：${job.company}\n匹配度：${decision.score}\n按钮：${actionLabel}\n\n只处理这一个岗位。是否继续？`
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
        if (outcome.type === 'chat_input') return completeChatGreeting(outcome.element, decision, job, autoMode);
        if (outcome.type === 'dialog') return completeConfirmationDialog(outcome.element, actionButton, decision, job, autoMode);
        if (outcome.type === 'success') return {success: true, detail: outcome.detail, mode: 'direct_action'};
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

    const finishRun = async (state, message, config) => {
        const done = {...state, active: false, paused: false, phase: 'done', finishedAt: Date.now()};
        await saveState(done);
        setRunButton(done);
        await addLog(message);
        await addLog(config?.executionMode === 'test'
            ? '发送安全锁：未发送任何消息或简历'
            : Number(state.liveSent || 0) > 0
                ? `本次已自动沟通 ${state.liveSent} 个岗位`
                : '本次正式扫描未执行真实沟通');
    };
    const recordLiveAttemptResult = async result => {
        if (result.retrySafe) {
            await forgetLiveAttempt({company: result.company, title: result.title});
        }
        const action = result.success
            ? 'zhaopin_greeting_sent'
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
            await addLog(`真实沟通已执行：${result.detail || '页面已显示成功状态'}`);
        } else if (result.authExpired) {
            await addLog(`智联登录已失效：本次确认未发送，请重新登录后再开始`);
        } else if (result.cancelled) {
            await addLog(`本次真实操作已取消：${result.reason}`);
        } else {
            await addLog(`本次真实操作未完成：${result.reason}`);
        }
        await addLog('单岗位安全限制：程序已自动停止，不会继续处理其他岗位');
    };
    const processCurrentKeyword = async (config, state, keywords, maxJobs) => {
        // 搜索可能打开/切换页面；先检查任务所有权，避免旧页面和新页面各输出一次倒计时。
        state = await waitIfPaused();
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
        const cards = await loadCards(Math.min(maxJobs, 100));
        if (!cards.length) {
            await addLog(`页面诊断：${pageDiagnostics()}`);
            throw new Error('没有识别到岗位列表；请确认已经登录，且当前页面确实显示了岗位卡片');
        }
        await addLog(platform === 'zhaopin' && Number(state.keywordIndex || 0) > 0
            ? `岗位列表已识别 ${cards.length} 条（可能包含前轮保留卡片，处理时自动去重）`
            : `岗位列表已识别 ${cards.length} 条`);
        const roundLimit = maxJobs;
        let current = await readState();
        const seen = new Set(Array.isArray(current.seen) ? current.seen : []);
        let roundProcessed = 0;
        for (const [index, card] of cards.entries()) {
            current = await waitIfPaused();
            if (keywordRemaining(current, maxJobs) <= 0 || roundProcessed >= roundLimit) break;
            const cardJob = extractCard(card, index);
            const key = cardJob.url || `${cardJob.title}|${cardJob.company}`;
            if (!cardJob.title || seen.has(key)) continue;
            seen.add(key);
            await addLog(`| 当前搜索词: ${maxJobs - keywordRemaining(current, maxJobs) + 1}/${maxJobs} | 正在获取职位详情 |`);
            const job = await fetchDetail(cardJob, card);
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
                current = {...recordKeywordView(current), seen: Array.from(seen).slice(-1000)};
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
            current = {...recordKeywordView(current), seen: Array.from(seen).slice(-1000)};
            await saveState(current);
            if (
                config.executionMode === 'live'
                && platform === 'zhaopin'
                && plan.allowExecute
            ) {
                const locallyAttempted = await hasLiveAttempt(job);
                if (locallyAttempted && plan.contactRetrySafe) {
                    await forgetLiveAttempt(job);
                    await addLog(`岗位 [${job.title}] 上次因登录失效确认未发送，已允许重试`);
                } else if (locallyAttempted) {
                    await addLog(`岗位 [${job.title}] 曾点击过真实沟通按钮，为避免重复联系已跳过`);
                    await logAction({
                        action: 'zhaopin_duplicate_attempt_blocked',
                        decisionId: decision.decisionId,
                        company: job.company,
                        title: job.title,
                    });
                    continue;
                }
                const autoMode = config.deliveryMode === 'auto';
                const result = await executeZhaopinGreeting(job, decision, autoMode);
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
                    await addLog(`自动沟通成功：[${job.company}] ${job.title}｜${result.detail || '已发起沟通'}`);
                    const nextDelay = 3500 + Math.floor(Math.random() * 3000);
                    await addLog(`将在 ${(nextDelay / 1000).toFixed(1)} 秒后继续，避免连续快速操作`);
                    await sleep(nextDelay);
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
            if (!['test', 'live'].includes(config.executionMode)) throw new Error('控制台运行模式无效');
            if (config.executionMode === 'live' && platform !== 'zhaopin') {
                throw new Error('当前平台尚未开放真实操作，请切换回“测试模式”');
            }
            if (config.executionMode === 'live' && !config.platforms?.[platform]?.enabled) {
                throw new Error(`本地控制台尚未启用${definition.name}，请先打开平台开关`);
            }
            if (!state.modeAnnounced) {
                await addLog(config.executionMode === 'test'
                    ? '运行模式：只测试，不发送'
                    : config.deliveryMode === 'auto'
                        ? '运行模式：智联正式模式｜自动沟通｜去重｜异常自动停止｜不发附件'
                    : '运行模式：智联正式模式｜筛选不发送');
                state = {...state, modeAnnounced: true};
                await saveState(state);
            }
            const keywords = Array.isArray(config.tags) ? config.tags.map(clean).filter(Boolean) : [];
            if (!keywords.length) throw new Error('控制台没有配置搜索关键词');
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
            seen: [],
            ownerId: INSTANCE_ID,
            startedAt: Date.now(),
            modeAnnounced: false,
        };
        await saveState(state);
        setRunButton(state);
        await addLog('--程序启动--');
        await addLog(`平台：${definition.name}｜${authState()}｜正在读取控制台运行模式`);
        await runEngine();
    };

    (async () => {
        if (await runDetailWorker()) return;
        ui = createPanel();
        renderLogs(await gmGet(LOG_KEY, []));
        ui.clearBtn.addEventListener('click', clearLogs);
        ui.runBtn.addEventListener('click', handleRunClick);
        let state = await readState();
        // 用户手动刷新代表结束本次运行；脚本点击搜索造成的正常页面跳转仍会自动续跑。
        if (state.active && navigationType() === 'reload') {
            state = {...state, active: false, paused: false, phase: 'refreshed', ownerId: INSTANCE_ID};
            await saveState(state);
            await addLog('检测到手动刷新，已结束旧任务；点击“开始”可重新运行');
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
