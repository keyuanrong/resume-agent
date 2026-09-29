import asyncio
import unittest
from unittest.mock import patch

import agent_service
import main
from core import evaluateJobMatch


class AgentWeightedScoringTests(unittest.TestCase):
    def test_confirmation_reconciles_edited_search_and_exclusions(self):
        old = {'mode': 'agent', 'strategy': {
            'source': 'agent', 'searchKeywords': ['旧方向'], 'targetRoles': ['旧方向'],
            'excludedKeywords': [], 'scoring': {
                'title_strong_keywords': {'旧方向': 85},
                'title_penalty_keywords': {'纯SLAM': 30},
                'title_block_keywords': {'纯SLAM': 100},
            },
        }}
        with patch.object(main, 'get_product_config', return_value=old), \
             patch.object(main, 'save_product_config', side_effect=lambda value, **_: value):
            saved = asyncio.run(main.api_confirm_strategy({
                'searchKeywords': 'VLA算法实习生',
                'excludedKeywords': '销售',
            }))['strategy']
        self.assertIn('VLA算法实习生', saved['scoring']['title_strong_keywords'])
        self.assertNotIn('旧方向', saved['scoring']['title_strong_keywords'])
        self.assertEqual(saved['scoring']['title_penalty_keywords']['纯SLAM'], 30)
        self.assertEqual(saved['scoring']['title_block_keywords'], {'销售': 100})

    def test_removed_exclusion_does_not_keep_a_soft_penalty(self):
        previous = {'excludedKeywords': ['销售']}
        scoring = agent_service.build_agent_scoring(
            {'searchKeywords': ['VLA算法工程师'], 'excludedKeywords': []},
            {'detail_negative_keywords': {'销售': 18}}, previous,
        )
        self.assertNotIn('销售', scoring['detail_negative_keywords'])
        self.assertNotIn('销售', scoring['title_block_keywords'])

    def test_agent_positive_and_soft_negative_words_affect_job_ranking(self):
        model_answer = {
            'searchKeywords': ['VLA算法工程师'],
            'targetRoles': ['VLA算法工程师'],
            'preferredSkills': ['π0', 'LeRobot'],
            'scoring': {
                'title_strong_keywords': {'VLA算法': 92},
                'detail_infra_keywords': {'π0': 16, 'LeRobot': 12},
                'title_penalty_keywords': {'纯SLAM': 35},
                'detail_negative_keywords': {'传统定位建图': 16},
                'title_block_keywords': {'纯SLAM': 100},
            },
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            final = agent_service.QwenAgent().build_strategy({}, {}, [], {})
        strategy = main._normalize_strategy(final, source='agent', confirmed=False)
        scoring = strategy['scoring']
        self.assertEqual(scoring['title_strong_keywords']['VLA算法'], 92)
        self.assertEqual(scoring['title_penalty_keywords']['纯SLAM'], 35)
        self.assertNotIn('纯SLAM', scoring['title_block_keywords'])
        positive = evaluateJobMatch('# 职位名称\nVLA算法工程师\n\n# 职位描述\n使用π0和LeRobot进行真机操作', scoring=scoring)
        adjacent = evaluateJobMatch('# 职位名称\n纯SLAM算法工程师\n\n# 职位描述\n传统定位建图与地图维护', scoring=scoring)
        self.assertGreater(positive['score'], adjacent['score'])
        self.assertFalse(adjacent['blocked'])

    def test_explicit_exclusion_is_the_only_agent_title_block(self):
        model_answer = {
            'searchKeywords': ['具身智能工程师'], 'targetRoles': ['具身智能工程师'],
            'scoring': {
                'title_block_keywords': {'算法工程师': 100},
                'title_penalty_keywords': {'传统SLAM': 30},
            },
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            final = agent_service.QwenAgent().build_strategy({}, {}, [], {'excludedKeywords': '销售'})
        scoring = main._normalize_strategy(final, source='agent', confirmed=False)['scoring']
        self.assertEqual(scoring['title_block_keywords'], {'销售': 100})
        self.assertIn('传统SLAM', scoring['title_penalty_keywords'])

    def test_changed_role_replaces_old_positive_role_but_keeps_relevant_soft_penalty(self):
        draft = {'targetRoles': ['旧方向'], 'scoring': {'title_penalty_keywords': {'纯SLAM': 30}}}
        model_answer = {
            'searchKeywords': ['旧方向'], 'targetRoles': ['旧方向'],
            'scoring': {
                'title_strong_keywords': {'旧方向': 95},
                'title_penalty_keywords': {'纯SLAM': 30},
            },
        }
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value=model_answer):
            final = agent_service.QwenAgent().build_strategy({}, draft, [], {'targetRoles': 'VLA算法实习生'})
        scoring = main._normalize_strategy(final, source='agent', confirmed=False)['scoring']
        self.assertIn('VLA算法实习生', scoring['title_strong_keywords'])
        self.assertNotIn('旧方向', scoring['title_strong_keywords'])
        self.assertEqual(scoring['title_penalty_keywords']['纯SLAM'], 30)


if __name__ == '__main__':
    unittest.main()
