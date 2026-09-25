import asyncio
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

    class HTTPException(Exception):
        pass

    def Body(*args, **kwargs):
        return ...

    fastapi_stub.FastAPI = FastAPI
    fastapi_stub.Body = Body
    fastapi_stub.HTTPException = HTTPException
    sys.modules['fastapi'] = fastapi_stub


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
        install_pydantic_stub()
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


if __name__ == '__main__':
    unittest.main()
