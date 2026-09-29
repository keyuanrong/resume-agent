import asyncio
import base64
import json
import sys
import tempfile
import types
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent
USER_CONFIG_PATH = ROOT / 'user_config.json'
ORIGINAL_USER_CONFIG = USER_CONFIG_PATH.read_text(encoding='utf-8') if USER_CONFIG_PATH.exists() else None
TEST_USER_CONFIG = {
    'resume_name': 'resume.md',
    'think_model': 'qwen3:0.6b',
    'chat_model': 'qwen3:0.6b',
    'introduce': '测试用打招呼语',
    'character': '简洁 直接 礼貌',
    'tags': ['AI产品工程师', 'AI应用工程师'],
    'backend': {
        'job_score_delay_base_ms': 0,
        'job_score_delay_jitter_ms': 0,
    },
    'frontend': {
        'serverHost': 'http://127.0.0.1:8000',
        'resumeIndex': 0,
        'thread': 50,
        'timestampTimeout': 3000,
        'onlyGreet': False,
        'manualFilterWaitMs': 10000,
        'roundRestartDelayMs': 2000,
        'maxEmptyRounds': 3,
        'detailTimeout': 10000,
        'greetTimeout': 12000,
        'preloadScrollPixels': 180,
        'preloadScrollWaitMs': 450,
        'preloadStableRoundsLimit': 24,
        'preloadMaxRounds': 300,
        'preloadActivateCardEvery': 0,
        'preloadActivateCardWaitMs': 250,
    },
    'scoring': {
        'title_block_keywords': {
            '销售': 100,
            '硬件工程师': 100,
        },
        'title_penalty_keywords': {
            '运维': 30,
            'langchain': 16,
        },
        'title_strong_keywords': {
            'ai产品工程师': 98,
            'ai应用工程师': 94,
            '智能体': 94,
            'vibe coding': 96,
            'vla算法实习生': 96,
            '机器人算法实习生': 20,
        },
        'title_medium_keywords': {
            'ai': 78,
            'workflow': 74,
            'prompt': 72,
            'vla': 45,
        },
        'detail_infra_keywords': {
            'claude code': 14,
            'codex': 12,
            '智能体': 10,
            '工作流': 8,
            'vla': 18,
            'lerobot': 16,
        },
        'detail_support_keywords': {
            'python': 8,
            '部署': 5,
            '代码生成': 5,
        },
        'detail_negative_keywords': {
            'langchain': 8,
            '推荐算法': 14,
            '广告算法': 16,
        },
        'title_core_keywords': ['vla', '具身智能算法', '具身算法', '灵巧手'],
        'explicit_vla_keywords': ['vla', 'openvla'],
        'detail_policy_model_keywords': ['pi0', 'π0', 'lerobot', 'act', 'diffusion policy'],
        'detail_robot_context_keywords': ['机器人操作', '机械臂', '真机', '仿真', 'mujoco', '机器人'],
        'detail_model_work_keywords': ['模型构建', '模型训练', '训练与调优', '模型部署', '算法研发', '论文复现', 'benchmark'],
        'detail_rl_dominant_keywords': ['reinforcement learning', 'reward model', 'critic', 'policy update', 'sac', 'ppo'],
        'detail_data_engineering_keywords': ['数据管线', '分布式计算', 'spark', 'dask', 'sql', 'webdataset'],
        'detail_localization_keywords': ['slam', '定位建图', 'lidar', 'imu', '目标跟踪'],
        'title_data_engineering_keywords': ['数据工程', '数据开发'],
        'title_control_keywords': ['强化学习运控', '运动控制', '运控算法'],
        'title_localization_keywords': ['感知定位', '定位算法', '定位建图', 'slam', '导航算法'],
    },
}


def install_fastapi_stub():
    if 'fastapi' in sys.modules:
        return

    fastapi_stub = types.ModuleType('fastapi')

    class FastAPI:
        def get(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

        def post(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

        def put(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

        def delete(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

    class HTTPException(Exception):
        pass

    def Body(*args, **kwargs):
        return ...

    fastapi_stub.FastAPI = FastAPI
    fastapi_stub.Body = Body
    fastapi_stub.HTTPException = HTTPException
    sys.modules['fastapi'] = fastapi_stub


def install_starlette_stub():
    if 'starlette.responses' in sys.modules:
        return

    starlette_stub = types.ModuleType('starlette')
    responses_stub = types.ModuleType('starlette.responses')

    class Response:
        def __init__(self, content=b'', status_code=200, media_type=None, **kwargs):
            self.body = content if isinstance(content, bytes) else str(content).encode('utf-8')
            self.status_code = status_code
            self.media_type = media_type

    class HTMLResponse(Response):
        pass

    responses_stub.Response = Response
    responses_stub.HTMLResponse = HTMLResponse
    sys.modules['starlette'] = starlette_stub
    sys.modules['starlette.responses'] = responses_stub


def install_pydantic_stub():
    if 'pydantic' in sys.modules:
        return

    pydantic_stub = types.ModuleType('pydantic')

    class BaseModel:
        @classmethod
        def model_json_schema(cls):
            return {}

    def Field(*args, **kwargs):
        return None

    pydantic_stub.BaseModel = BaseModel
    pydantic_stub.Field = Field
    sys.modules['pydantic'] = pydantic_stub


def purge_modules():
    for name in ['config', 'core', 'main']:
        sys.modules.pop(name, None)


class SingleRouteBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_fastapi_stub()
        install_pydantic_stub()
        install_starlette_stub()
        USER_CONFIG_PATH.write_text(
            json.dumps(TEST_USER_CONFIG, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
        purge_modules()

    @classmethod
    def tearDownClass(cls):
        if ORIGINAL_USER_CONFIG is None:
            USER_CONFIG_PATH.unlink(missing_ok=True)
        else:
            USER_CONFIG_PATH.write_text(ORIGINAL_USER_CONFIG, encoding='utf-8')
        purge_modules()

    def test_client_config_no_longer_exposes_profile(self):
        from config import Config

        client_config = Config.get_client_config()
        self.assertIn('introduce', client_config)
        self.assertIn('frontend', client_config)
        self.assertNotIn('profile', client_config)

    def test_single_route_delivery_uses_fixed_introduce_and_resume_index(self):
        from core import evaluateSingleRouteDelivery
        from config import Config

        job = '# 职位名称\nAI产品工程师\n\n# 薪资范围\n20-30K\n\n# 职位描述\n负责 Claude Code、Codex、智能体、工作流与代码生成调试部署'
        result = evaluateSingleRouteDelivery(job)

        self.assertEqual(result['introduce'], Config.introduce)
        self.assertEqual(result['resumeIndex'], Config.frontend.get('resumeIndex', 0))
        self.assertNotIn('profile', result)
        self.assertNotIn('route_reason', result)
        self.assertNotIn('route_scores', result)

    def test_scoring_groups_replace_defaults_instead_of_merging(self):
        from config import Config

        self.assertEqual(Config.title_block_keywords, TEST_USER_CONFIG['scoring']['title_block_keywords'])
        self.assertNotIn('算法', Config.title_block_keywords)
        self.assertNotIn('训练', Config.title_block_keywords)

    def test_vla_internship_is_not_blocked_by_algorithm_or_training_words(self):
        from core import evaluateJobMatch

        job = '# 职位名称\nVLA算法实习生\n\n# 薪资范围\n200-300元/天\n\n# 职位描述\n参与VLA模型训练、LeRobot数据处理和真机验证'
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertGreaterEqual(result['score'], 90)

    def test_title_uses_highest_score_across_strong_and_medium_groups(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n机器人算法实习生（VLA方向）\n\n# 薪资范围\n200-300元/天\n\n# 职位描述\n参与基础开发'
        result = evaluateJobMatch(job)

        self.assertEqual(result['title_score'], 45)
        self.assertEqual(result['keyword'], 'vla')

    def test_labeled_pi0_embodied_role_reaches_delivery_threshold(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n具身智能算法实习生\n\n# 薪资范围\n220-300元/天\n\n# 职位描述\n负责具身模型构建，了解Pi0，在仿真环境验证机器人操作'
        result = evaluateJobMatch(job)

        self.assertGreaterEqual(result['score'], 90)
        self.assertTrue(result['high_confidence_match'])

    def test_labeled_rl_dominant_vla_role_is_capped(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n全栈VLA RL算法实习生\n\n# 薪资范围\n300-500元/天\n\n# 职位描述\n研究Reinforcement Learning、Reward Model、Critic、Policy Update、SAC和PPO'
        result = evaluateJobMatch(job)

        self.assertLess(result['score'], 90)
        self.assertEqual(result['dominant_profile'], 'rl')

    def test_labeled_vla_data_infrastructure_role_is_capped(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n具身智能数据工程实习生\n\n# 薪资范围\n400-600元/天\n\n# 职位描述\n为VLA训练开发数据管线，使用Spark、Dask、SQL、WebDataset和分布式计算优化存储'
        result = evaluateJobMatch(job)

        self.assertLess(result['score'], 90)
        self.assertEqual(result['dominant_profile'], 'data_engineering')

    def test_labeled_localization_role_is_capped(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n定位建图算法实习生\n\n# 薪资范围\n200-300元/天\n\n# 职位描述\n负责LiDAR、IMU融合的SLAM定位建图和目标跟踪，偶尔参与VLA模型训练'
        result = evaluateJobMatch(job)

        self.assertLess(result['score'], 90)
        self.assertEqual(result['dominant_profile'], 'localization')

    def test_labeled_control_role_is_capped_even_with_imitation_learning(self):
        from core import evaluateJobMatch

        job = '# 职位名称\n强化学习运控实习生\n\n# 薪资范围\n300-400元/天\n\n# 职位描述\n负责双足运动控制，使用强化学习、模仿学习、MPC并在MuJoCo中训练'
        result = evaluateJobMatch(job)

        self.assertLess(result['score'], 90)
        self.assertEqual(result['dominant_profile'], 'control')

    def test_mixed_vla_control_role_is_not_control_capped(self):
        from core import evaluateJobMatch

        job = '# 职位名称\nVLA算法实习生（运控协同方向）\n\n# 薪资范围\n300-400元/天\n\n# 职位描述\n负责VLA模型训练、ACT机器人操作策略和MuJoCo真机验证'
        result = evaluateJobMatch(job)

        self.assertGreaterEqual(result['score'], 90)
        self.assertNotEqual(result['dominant_profile'], 'control')

    def test_search_greeting_uses_single_boss_api_path(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn("action: 'greet_api_succeeded'", script)
        self.assertIn('navigator.locks.request', script)
        self.assertIn('window.open(jobInfo.chatUrl, this.targets.chatView)', script)
        self.assertNotIn(
            'tools.openTabNSetTimestamp(jobInfo.chatUrl, this.targets.chatGreet)',
            script,
        )

    def test_company_extraction_covers_current_boss_card_and_recruiter_area(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn("COMPANY: '.boss-name", script)
        self.assertIn('getCompanyFromRecruiterCard', script)
        self.assertIn("document.querySelector('.job-boss-info')", script)

    def test_multi_platform_runner_keeps_test_lock_and_limits_live_greeting(self):
        script = (ROOT / 'multi_platform_test.user.js').read_text(encoding='utf-8')

        for marker in (
            '清空', '开始', '暂停', '继续', '收起', '展开',
            '本轮搜索关键词', 'keywordIndex', 'maxJobsPerRun', 'maxJobsPerRound',
            "'/get-job-score'", "'/api/execution/plan'", '发送安全锁', 'GM_openInTab',
            'platform_dom_diagnostics', 'visibleJobLinkCount', 'detailLength',
            'platform_structure_diagnostics', 'repeatedStructures', 'resourcePaths',
            "cards: ['.job-card'", 'fetchInlineZhaopinDetail', 'inline_detail_panel',
            'clickTarget.click()', 'platform_job_detail_failed', 'observedTitle', 'companyMatched', 'isOutsourcedClient', 'clientCompany', 'detailBodyText', '职位描述|职位详情|岗位职责', '•…⋯', '不使用卡片摘要评分', '先检查任务所有权',
            "navigationType() === 'reload'", '检测到手动刷新',
        ):
            self.assertIn(marker, script)
        self.assertIn('bottom:16px;left:16px;width:380px', script)
        self.assertIn("config.executionMode === 'test' && plan.allowExecute", script)
        self.assertIn("config.executionMode === 'live' && platform !== 'zhaopin'", script)
        self.assertIn("!config.platforms?.[platform]?.enabled", script)
        self.assertIn("plan.blockedBy === 'user_confirmation_required'", script)
        self.assertIn('window.confirm(', script)
        self.assertIn('单岗位安全限制', script)
        self.assertIn('zhaopin_greeting_sent', script)
        self.assertIn('rememberLiveAttempt(job, decision, actionLabel)', script)
        self.assertIn('zhaopin_duplicate_attempt_blocked', script)
        self.assertNotIn('sendGreeting(', script)
        self.assertNotIn('sendResume(', script)
        self.assertNotIn('applyJob(', script)

    def test_platform_console_has_a_real_enable_control(self):
        app_script = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')

        self.assertIn("checkbox.type = 'checkbox'", app_script)
        self.assertIn("platforms:{[p.id]:{enabled}}", app_script)
        self.assertIn("controlText.textContent = enabled", app_script)

    def test_company_blacklist_runs_before_scoring_and_greeting(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        blocked_action = "action: 'job_company_blocked'"
        score_call = 'const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail, jobInfo.company);'
        self.assertIn(blocked_action, script)
        self.assertIn('getBlockedCompanyKeyword(jobInfo.company)', script)
        self.assertIn('if (!isUsableCompanyName(info.company))', script)
        self.assertIn("'公司', '公司信息', '企业', '企业信息'", script)
        self.assertIn("action: 'job_company_unknown'", script)
        self.assertLess(script.index(blocked_action), script.index(score_call))

    def test_get_job_score_returns_single_route_shape(self):
        install_fastapi_stub()
        import main

        job = '# 职位名称\nAI产品工程师\n\n# 薪资范围\n20-30K\n\n# 职位描述\n负责 Claude Code、Codex、智能体、工作流与代码生成调试部署'
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(main, 'LOG_PATH', Path(temp_dir) / 'job_decisions.jsonl'):
                result = asyncio.run(main.get_job_score(job))

        self.assertIn('score', result)
        self.assertIn('introduce', result)
        self.assertIn('resumeIndex', result)
        self.assertIn('decisionId', result)
        self.assertNotIn('profile', result)
        self.assertNotIn('routeReason', result)
        self.assertNotIn('routeScores', result)

    def test_structured_job_records_company_and_report_columns(self):
        import main

        with tempfile.TemporaryDirectory() as temp_dir:
            decision_path = Path(temp_dir) / 'job_decisions.jsonl'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            with mock.patch.object(main, 'LOG_PATH', decision_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                result = asyncio.run(main.get_job_score({
                    'title': 'AI应用工程师',
                    'company': '测试公司',
                    'salary': '200-300元/天',
                    'detail': '负责 Python、Codex 和部署',
                }))
                last_record = json.loads(decision_path.read_text(encoding='utf-8').splitlines()[-1])

                self.assertEqual(last_record['company'], '测试公司')
                self.assertEqual(last_record['salary'], '200-300元/天')
                self.assertEqual(last_record['decisionId'], result['decisionId'])

                response = asyncio.run(main.get_job_report())
                page = response.body.decode('utf-8')
        for column in ['时间', '公司', '岗位', '薪资', '分数', '结果']:
            self.assertIn(f'<th>{column}</th>', page)

    def test_json_line_escapes_unusual_line_terminators(self):
        from main import _json_line

        line = _json_line({'detail': '第一段\u2028第二段\u2029第三段'})

        self.assertNotIn('\u2028', line)
        self.assertNotIn('\u2029', line)
        self.assertIn('\\u2028', line)
        self.assertIn('\\u2029', line)

    def test_company_blocked_action_appears_in_report_without_scoring(self):
        install_fastapi_stub()
        import main

        with tempfile.TemporaryDirectory() as temp_dir:
            decision_path = Path(temp_dir) / 'job_decisions.jsonl'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            with mock.patch.object(main, 'LOG_PATH', decision_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                main.append_job_action_log({
                    'action': 'job_company_blocked',
                    'company': '北京万仞智慧智能科技有限公司',
                    'title': 'VLA算法实习生',
                    'salary': '300-400元/天',
                })
                rows = main.build_job_report_rows()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['company'], '北京万仞智慧智能科技有限公司')
        self.assertEqual(rows[0]['result'], '公司屏蔽')

    def test_generic_company_heading_is_shown_as_unrecorded(self):
        import main

        decision = {
            'loggedAt': '2026-09-02T10:47:38',
            'decisionId': 'old-company-heading',
            'company': '公司',
            'title': '算法实习生',
            'salary': '150-200元/天',
            'score': 80,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / 'job_decisions.jsonl'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            log_path.write_text(json.dumps(decision, ensure_ascii=False) + '\n', encoding='utf-8')
            with mock.patch.object(main, 'LOG_PATH', log_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                rows = main.build_job_report_rows()

        self.assertEqual(rows[0]['company'], '未记录')

    def test_product_console_and_platform_registry_are_available(self):
        import main

        response = asyncio.run(main.product_home())
        page = response.body.decode('utf-8')
        platforms = asyncio.run(main.api_platforms())

        self.assertIn('智能求职 Agent', page)
        self.assertIn('测试模式（推荐）', page)
        self.assertEqual([item['id'] for item in platforms], ['boss', 'zhaopin', 'job51'])
        self.assertTrue(platforms[0]['implemented'])
        self.assertTrue(platforms[1]['implemented'])
        self.assertTrue(platforms[1]['manualConfirmationRequired'])
        self.assertFalse(platforms[2]['implemented'])
        for platform in platforms:
            self.assertIn('company', platform['requiredJobFields'])
            self.assertTrue(platform['companyExtraction']['listSelectors'])
            self.assertTrue(platform['companyExtraction']['detailSelectors'])

    def test_execution_plan_blocks_all_platforms_in_test_mode(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['VLA算法实习生'],
                    'threshold': 50,
                    'deliveryMode': 'auto',
                }))
                product_store.save_product_config({'executionMode': 'test'})
                for platform in ('boss', 'zhaopin', 'job51'):
                    with self.subTest(platform=platform):
                        plan = asyncio.run(main.api_execution_plan({
                            'platform': platform,
                            'job': {'platform': platform, 'company': '测试科技有限公司'},
                            'decision': {'score': 100},
                        }))
                        self.assertFalse(plan['allowExecute'])
                        self.assertEqual(plan['blockedBy'], 'test_mode')
                        self.assertTrue(plan['plannedActions'])

    def test_unfinished_platform_stays_blocked_even_in_live_mode(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['VLA算法实习生'],
                    'threshold': 50,
                    'deliveryMode': 'auto',
                }))
                product_store.save_product_config({'executionMode': 'live'})
                plan = asyncio.run(main.api_execution_plan({
                    'platform': 'job51',
                    'job': {'platform': 'job51', 'company': '测试科技有限公司'},
                    'decision': {'score': 100},
                }))

        self.assertFalse(plan['allowExecute'])
        self.assertEqual(plan['blockedBy'], 'adapter_not_live')

    def test_zhaopin_live_execution_requires_explicit_user_confirmation(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['大客户销售'],
                    'threshold': 80,
                    'deliveryMode': 'review',
                }))
                product_store.save_product_config({
                    'executionMode': 'live',
                    'platforms': {'zhaopin': {'enabled': True}},
                })
                payload = {
                    'platform': 'zhaopin',
                    'job': {'platform': 'zhaopin', 'company': '测试科技有限公司'},
                    'decision': {'score': 100},
                }
                pending = asyncio.run(main.api_execution_plan(payload))
                confirmed = asyncio.run(main.api_execution_plan({**payload, 'confirmedByUser': True}))

        self.assertFalse(pending['allowExecute'])
        self.assertEqual(pending['blockedBy'], 'user_confirmation_required')
        self.assertTrue(pending['manualConfirmationRequired'])
        self.assertTrue(confirmed['allowExecute'])
        self.assertIsNone(confirmed['blockedBy'])

    def test_zhaopin_auto_mode_can_execute_without_per_job_confirmation(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['大客户销售'],
                    'threshold': 80,
                    'deliveryMode': 'auto',
                }))
                product_store.save_product_config({
                    'executionMode': 'live',
                    'platforms': {'zhaopin': {'enabled': True}},
                })
                plan = asyncio.run(main.api_execution_plan({
                    'platform': 'zhaopin',
                    'job': {'platform': 'zhaopin', 'company': '测试科技', 'title': '大客户销售'},
                    'decision': {'score': 100},
                }))

        self.assertTrue(plan['allowExecute'])
        self.assertFalse(plan['manualConfirmationRequired'])
        self.assertIsNone(plan['blockedBy'])
        self.assertEqual(plan['plannedActions'][0]['type'], 'auto_greet')

    def test_zhaopin_prior_real_click_blocks_duplicate_contact(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            action_path.write_text(json.dumps({
                'platform': 'zhaopin',
                'action': 'zhaopin_contact_clicking',
                'company': '厚朴(深圳)人工智能有限公司',
                'title': 'ka大客户销售经理',
            }, ensure_ascii=False) + '\n', encoding='utf-8')
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['大客户销售'],
                    'threshold': 80,
                    'deliveryMode': 'review',
                }))
                product_store.save_product_config({
                    'executionMode': 'live',
                    'platforms': {'zhaopin': {'enabled': True}},
                })
                plan = asyncio.run(main.api_execution_plan({
                    'platform': 'zhaopin',
                    'job': {'platform': 'zhaopin', 'company': '厚朴(深圳)人工智能有限公司', 'title': 'ka大客户销售经理'},
                    'decision': {'score': 100},
                    'confirmedByUser': True,
                }))

        self.assertFalse(plan['allowExecute'])
        self.assertTrue(plan['contactAttempted'])
        self.assertEqual(plan['blockedBy'], 'duplicate_contact_attempt')

    def test_zhaopin_expired_login_after_click_is_safe_to_retry(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            action_path = Path(temp_dir) / 'job_actions.jsonl'
            actions = [
                {'platform': 'zhaopin', 'action': 'zhaopin_contact_clicking', 'company': '测试公司', 'title': '大客户销售'},
                {'platform': 'zhaopin', 'action': 'zhaopin_greeting_failed', 'company': '测试公司', 'title': '大客户销售', 'reason': '用户凭证失效'},
            ]
            action_path.write_text(''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in actions), encoding='utf-8')
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'ACTION_LOG_PATH', action_path):
                asyncio.run(main.api_manual_strategy({'searchKeywords': ['大客户销售'], 'threshold': 80, 'deliveryMode': 'review'}))
                product_store.save_product_config({'executionMode': 'live', 'platforms': {'zhaopin': {'enabled': True}}})
                plan = asyncio.run(main.api_execution_plan({
                    'platform': 'zhaopin',
                    'job': {'platform': 'zhaopin', 'company': '测试公司', 'title': '大客户销售'},
                    'decision': {'score': 100},
                }))

        self.assertFalse(plan['contactAttempted'])
        self.assertTrue(plan['contactRetrySafe'])
        self.assertEqual(plan['blockedBy'], 'user_confirmation_required')

    def test_unconfirmed_product_strategy_defaults_to_review_mode(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            log_path = Path(temp_dir) / 'job_decisions.jsonl'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'LOG_PATH', log_path):
                client = asyncio.run(main.get_client_config())
                result = asyncio.run(main.get_job_score(
                    '# 职位名称\nVLA算法实习生\n\n# 职位描述\n负责 VLA 和 LeRobot 模型训练'
                ))

        self.assertEqual(client['deliveryMode'], 'review')
        self.assertTrue(client['frontend']['onlyGreet'])
        self.assertFalse(result['autoSend'])

    def test_manual_strategy_updates_existing_client_config(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': 'VLA实习生\n机器人学习',
                    'excludedKeywords': '销售, SLAM',
                    'companyBlockKeywords': '测试公司',
                    'threshold': 86,
                    'dailyLimit': 25,
                    'greeting': '您好，想进一步了解岗位。',
                    'deliveryMode': 'review',
                }))
                client = asyncio.run(main.get_client_config())

        self.assertEqual(client['tags'], ['VLA实习生', '机器人学习'])
        self.assertEqual(client['introduce'], '您好，想进一步了解岗位。')
        self.assertEqual(client['frontend']['thread'], 86)
        self.assertEqual(client['frontend']['maxJobsPerRun'], 25)
        self.assertEqual(client['deliveryMode'], 'review')
        self.assertTrue(client['frontend']['onlyGreet'])

    def test_review_mode_returns_no_auto_send(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            log_path = Path(temp_dir) / 'job_decisions.jsonl'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'LOG_PATH', log_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['VLA算法实习生'],
                    'threshold': 50,
                    'greeting': '您好',
                    'deliveryMode': 'review',
                }))
                result = asyncio.run(main.get_job_score(
                    '# 职位名称\nVLA算法实习生\n\n# 薪资范围\n200元/天\n\n# 职位描述\n负责VLA、LeRobot、ACT模型训练和真机验证'
                ))

        self.assertFalse(result['autoSend'])
        self.assertEqual(result['decisionMode'], 'review')

    def test_confirmed_company_blacklist_is_enforced_by_backend(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            log_path = Path(temp_dir) / 'job_decisions.jsonl'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'LOG_PATH', log_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['VLA算法实习生'],
                    'companyBlockKeywords': ['测试公司'],
                    'threshold': 50,
                    'deliveryMode': 'auto',
                }))
                result = asyncio.run(main.get_job_score({
                    'title': 'VLA算法实习生',
                    'company': '北京测试公司有限公司',
                    'salary': '200元/天',
                    'detail': '负责 VLA、LeRobot、ACT 模型训练和真机验证',
                }))

        self.assertEqual(result['score'], 0)
        self.assertIn('公司黑名单', result['reason'])

    def test_auto_mode_enables_existing_boss_resume_flow(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['机器人学习'],
                    'deliveryMode': 'auto',
                    'resumeDelivery': 'platform_resume',
                }))
                product_store.save_product_config({'executionMode': 'live'})
                client = asyncio.run(main.get_client_config())

        self.assertFalse(client['frontend']['onlyGreet'])
        self.assertEqual(client['deliveryMode'], 'auto')

    def test_test_environment_blocks_boss_auto_send_even_when_delivery_is_auto(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            log_path = Path(temp_dir) / 'job_decisions.jsonl'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'LOG_PATH', log_path):
                asyncio.run(main.api_manual_strategy({
                    'searchKeywords': ['VLA算法实习生'],
                    'threshold': 50,
                    'deliveryMode': 'auto',
                }))
                product_store.save_product_config({'executionMode': 'test'})
                client = asyncio.run(main.get_client_config())
                result = asyncio.run(main.get_job_score({
                    'platform': 'boss',
                    'title': 'VLA算法实习生',
                    'company': '测试科技有限公司',
                    'detail': '负责VLA、LeRobot和机器人操作模型训练',
                }))

        self.assertTrue(client['frontend']['onlyGreet'])
        self.assertFalse(result['autoSend'])
        self.assertEqual(result['executionMode'], 'test')

    def test_missing_company_forces_review_on_every_platform(self):
        import main
        import product_store

        for platform in ('boss', 'zhaopin', 'job51'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temp_dir:
                config_path = Path(temp_dir) / 'product_config.json'
                secrets_path = Path(temp_dir) / 'secrets.json'
                log_path = Path(temp_dir) / 'job_decisions.jsonl'
                with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'LOG_PATH', log_path):
                    asyncio.run(main.api_manual_strategy({
                        'searchKeywords': ['VLA算法实习生'],
                        'threshold': 50,
                        'deliveryMode': 'auto',
                    }))
                    result = asyncio.run(main.get_job_score({
                        'platform': platform,
                        'title': 'VLA算法实习生',
                        'company': '',
                        'detail': '负责 VLA、LeRobot 和 ACT 模型训练',
                    }))

            self.assertFalse(result['autoSend'])
            self.assertTrue(result['companyMissing'])
            self.assertIn('未识别公司名称', result['reason'])

    def test_agent_strategy_can_be_edited_before_confirmation(self):
        import main
        import product_store

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                product_store.save_product_config({
                    'mode': 'agent',
                    'strategy': {'confirmed': False, 'searchKeywords': ['旧关键词'], 'threshold': 80},
                })
                result = asyncio.run(main.api_confirm_strategy({
                    'searchKeywords': 'VLA\n机器人学习',
                    'threshold': 0,
                    'deliveryMode': 'review',
                }))

        self.assertTrue(result['strategy']['confirmed'])
        self.assertEqual(result['strategy']['searchKeywords'], ['VLA', '机器人学习'])
        self.assertEqual(result['strategy']['threshold'], 0)

    def test_local_resume_generator_builds_a_personal_backend_dictionary(self):
        from core import evaluateJobMatch
        from local_strategy_service import generate_local_strategy

        generated = generate_local_strategy(
            '求职意向：Java后端开发工程师\n技能：Java、Spring Boot、MySQL、Redis、微服务、Docker\n'
            '项目经历：使用Spring Boot和Redis开发订单服务，负责接口设计和部署。',
            resume_id='resume-java',
        )
        strategy = generated['draftStrategy']
        java_job = '# 职位名称\nJava后端开发工程师\n\n# 薪资范围\n20-30K\n\n# 职位描述\n使用Java、Spring Boot、MySQL和Redis开发微服务'
        vla_job = '# 职位名称\nVLA算法实习生\n\n# 薪资范围\n200元/天\n\n# 职位描述\n负责LeRobot、ACT和机器人操作模型训练'

        self.assertEqual(strategy['source'], 'local_resume')
        self.assertIn('Java后端开发工程师', strategy['searchKeywords'])
        self.assertIn('spring boot', [item.lower() for item in strategy['preferredSkills']])
        self.assertGreaterEqual(evaluateJobMatch(java_job, strategy['scoring'])['score'], 80)
        self.assertLess(evaluateJobMatch(vla_job, strategy['scoring'])['score'], 80)

    def test_sales_resume_treats_sales_as_positive_not_a_global_block(self):
        from core import evaluateJobMatch
        from local_strategy_service import generate_local_strategy

        generated = generate_local_strategy(
            '求职意向：大客户销售\n五年企业客户开发经验，负责CRM、商务谈判、渠道建设、招投标、回款和续费，连续完成销售目标。',
            direction_id='sales',
        )
        strategy = generated['draftStrategy']
        job = '# 职位名称\n大客户销售\n\n# 薪资范围\n15-25K\n\n# 职位描述\n负责企业客户开发、商务谈判、CRM管理、招投标和回款'
        result = evaluateJobMatch(job, strategy['scoring'])

        self.assertNotIn('销售', strategy['scoring']['title_block_keywords'])
        self.assertIn('sales', generated['selectedDirectionId'])
        self.assertFalse(result['blocked'])
        self.assertGreaterEqual(result['score'], 80)

    def test_local_resume_requires_direction_confirmation_before_saving_strategy(self):
        import main
        import product_store

        resume_text = '目标岗位：前端开发工程师\n熟悉JavaScript、TypeScript、React、Vue、HTML、CSS和Vite。'
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path), mock.patch.object(main, 'get_resume_text_local', return_value={'kind': 'text', 'text': resume_text}):
                analysis = asyncio.run(main.api_local_analyze_resume({'resumeId': 'resume-front'}))
                before_choice = product_store.get_product_config(public=False)
                result = asyncio.run(main.api_local_build_strategy({'resumeId': 'resume-front', 'directionId': 'frontend'}))
                after_choice = product_store.get_product_config(public=False)

        self.assertIsNone(analysis['draftStrategy'])
        self.assertTrue(analysis['candidateDirections'])
        self.assertEqual(before_choice['strategy']['source'], 'manual')
        self.assertEqual(after_choice['mode'], 'manual')
        self.assertFalse(after_choice['agent']['enabled'])
        self.assertFalse(after_choice['strategy']['confirmed'])
        self.assertEqual(after_choice['strategy']['source'], 'local_resume')
        self.assertTrue(after_choice['strategy']['scoring']['title_strong_keywords'])
        self.assertIn('React'.lower(), [item.lower() for item in result['profile']['skills']])

    def test_embedded_direction_does_not_inherit_vla_skills_from_same_resume(self):
        from local_strategy_service import analyze_local_resume, generate_local_strategy

        resume_text = '参与VLA、Pi0和机械臂项目；另有STM32、FreeRTOS嵌入式开发经验。'
        analysis = analyze_local_resume(resume_text, filename='嵌入式简历.pdf')
        generated = generate_local_strategy(
            resume_text,
            filename='嵌入式简历.pdf',
            direction_id='embedded',
        )
        skills = [item.lower() for item in generated['draftStrategy']['preferredSkills']]

        self.assertIn('stm32', skills)
        self.assertIn('freertos', skills)
        self.assertNotIn('vla', skills)
        self.assertEqual(analysis['recommendedDirectionId'], 'embedded')
        self.assertEqual(generated['selectedDirectionId'], 'embedded')

    def test_new_resume_strategy_replaces_previous_dictionary_instead_of_merging(self):
        import product_store
        from local_strategy_service import generate_local_strategy

        vla = generate_local_strategy(
            '求职意向：VLA算法工程师\n掌握VLA、LeRobot、ACT、机械臂和MuJoCo。',
            direction_id='robot_vla',
        )['draftStrategy']
        sales = generate_local_strategy(
            '求职意向：大客户销售\n负责CRM、客户开发、商务谈判、渠道建设、回款、续费和招投标。',
            direction_id='sales',
        )['draftStrategy']
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / 'product_config.json'
            secrets_path = Path(temp_dir) / 'secrets.json'
            with mock.patch.object(product_store, 'CONFIG_PATH', config_path), mock.patch.object(product_store, 'SECRETS_PATH', secrets_path):
                product_store.save_product_config({'strategy': vla}, replace_strategy=True)
                product_store.save_product_config({'strategy': sales}, replace_strategy=True)
                stored = product_store.get_product_config(public=False)['strategy']

        title_terms = stored['scoring']['title_strong_keywords']
        self.assertIn('大客户销售', title_terms)
        self.assertNotIn('VLA算法工程师', title_terms)

    def test_manual_console_exposes_local_resume_dictionary_editor(self):
        page = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        script = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')

        for marker in ('localResumeSelect', 'buildLocalStrategyButton', 'localDirectionSelect', 'rebuildLocalStrategyButton', 'manualTitlePositive', 'manualDetailPositive', 'manualTitlePenalty', 'manualDetailNegative'):
            self.assertIn(f'id="{marker}"', page)
            self.assertIn(marker, script)
        self.assertIn("'/api/local/analyze-resume'", script)
        self.assertIn("'/api/local/build-strategy'", script)
        self.assertLess(page.index('id="resumeFile"'), page.index('id="agentToggle"'))
        self.assertLess(page.index('id="agentToggle"'), page.index('id="manualForm"'))
        self.assertLess(page.index('id="manualForm"'), page.index('id="platformList"'))
        self.assertLess(page.index('id="platformList"'), page.index('id="executionMode"'))

    def test_resume_dropzone_supports_progress_cancel_selection_and_removal(self):
        page = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        script = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')

        for marker in ('resumeDropzone', 'resumeFile', 'uploadQueue', 'resumeList'):
            self.assertIn(f'id="{marker}"', page)
        self.assertNotIn('id="uploadResumeButton"', page)
        for marker in ('XMLHttpRequest', 'xhr.upload.onprogress', 'cancelUpload', "method:'DELETE'", "addEventListener('drop'"):
            self.assertIn(marker, script)

    def test_uploaded_resume_can_be_removed(self):
        import product_store
        import resume_service

        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            resume_dir = data_dir / 'resumes'
            index_path = data_dir / 'resumes.json'
            with mock.patch.object(resume_service, 'RESUME_DIR', resume_dir), mock.patch.object(product_store, 'RESUME_INDEX_PATH', index_path):
                record = resume_service.save_resume(
                    'wrong.txt',
                    'text/plain',
                    base64.b64encode(b'wrong resume').decode('ascii'),
                )
                saved_path = data_dir / record['path']
                self.assertTrue(saved_path.exists())
                deleted = resume_service.delete_resume(record['id'])

        self.assertEqual(deleted['name'], 'wrong.txt')
        self.assertFalse(saved_path.exists())


if __name__ == '__main__':
    unittest.main()
