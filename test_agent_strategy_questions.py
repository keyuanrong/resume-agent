import unittest
from datetime import date
from unittest.mock import patch

import agent_service
import main


class StrategyQuestionTests(unittest.TestCase):
    def test_analysis_replaces_interview_questions_with_keyword_decisions(self):
        answer = {
            'profile': {
                'summary': '机器人算法项目',
                'targetRoleHints': ['VLA算法工程师', 'SLAM工程师'],
                'risks': ['2025-2026年相对当前可能是未来经历', '2027年毕业，需确认求职类型'],
            },
            'questions': ['最快何时入职？', '是否有其他 Offer？'],
            'draftStrategy': {'searchKeywords': ['机器人算法']},
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=answer) as request:
            result = agent_service.QwenAgent().analyze_resume({'kind': 'text', 'text': 'VLA算法项目经历'})
        self.assertTrue(all(isinstance(item, dict) for item in result['questions']))
        ids = [item['id'] for item in result['questions']]
        self.assertEqual(ids, ['targetRoles', 'preferredSkills', 'excludedKeywords', 'cities', 'jobType'])
        self.assertIn('VLA算法工程师', result['questions'][0]['question'])
        self.assertTrue(all('Offer' not in item['question'] and '入职' not in item['question'] for item in result['questions']))
        self.assertEqual(result['profile']['risks'], ['2027年毕业，需确认求职类型'])
        self.assertIn(date.today().isoformat(), request.call_args.args[0][0]['content'])

    def test_explicit_answers_change_final_search_and_filter_fields(self):
        model_answer = {
            'searchKeywords': ['旧方向'], 'targetRoles': ['旧方向'],
            'preferredSkills': ['旧技能'], 'excludedKeywords': [],
            'cities': [], 'jobType': '',
        }
        answers = {
            'targetRoles': 'VLA算法实习生、具身智能工程师',
            'preferredSkills': 'π0, LeRobot',
            'excludedKeywords': '销售，纯SLAM',
            'cities': '北京、天津',
            'jobType': '实习',
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            result = agent_service.QwenAgent().build_strategy({}, {}, [], answers)
        self.assertEqual(result['targetRoles'], ['VLA算法实习生', '具身智能工程师'])
        self.assertEqual(result['searchKeywords'][:2], ['VLA算法实习生', '具身智能工程师'])
        self.assertEqual(result['preferredSkills'], ['π0', 'LeRobot'])
        self.assertEqual(result['excludedKeywords'], ['销售', '纯SLAM'])
        self.assertEqual(result['cities'], ['北京', '天津'])
        self.assertEqual(result['jobType'], '实习')

    def test_blank_city_and_exclusion_answers_mean_no_restriction(self):
        model_answer = {
            'searchKeywords': ['机器人算法'], 'excludedKeywords': ['销售'],
            'cities': ['天津'], 'jobType': '实习',
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            result = agent_service.QwenAgent().build_strategy({}, {}, [], {
                'excludedKeywords': '', 'cities': '', 'jobType': '',
            })
        self.assertEqual(result['excludedKeywords'], [])
        self.assertEqual(result['cities'], [])
        self.assertEqual(result['jobType'], '')

    def test_keyword_scoring_is_rebuilt_after_answers_change_roles(self):
        model_answer = {
            'searchKeywords': ['旧方向'], 'targetRoles': ['旧方向'],
            'preferredSkills': ['旧技能'], 'excludedKeywords': [],
            'scoring': {'title_strong_keywords': {'旧方向': 99}},
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            result = agent_service.QwenAgent().build_strategy({}, {}, [], {
                'targetRoles': 'VLA算法实习生', 'excludedKeywords': '销售',
            })
        normalized = main._normalize_strategy(result, source='agent', confirmed=False)
        self.assertIn('VLA算法实习生', normalized['scoring']['title_strong_keywords'])
        self.assertNotIn('旧方向', normalized['scoring']['title_strong_keywords'])
        self.assertIn('销售', normalized['scoring']['title_block_keywords'])


if __name__ == '__main__':
    unittest.main()
