import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main
import agent_service
import resume_service
from core import evaluateJobMatch
from local_strategy_service import generate_local_strategy


RESUME = (
    '求职意向：VLA算法工程师\n'
    'VLA算法实习生：基于π0.5与LeRobot开发机械臂真机在线强化学习系统，'
    '训练残差策略并通过人工干预改进机器人操作。\n'
    '项目：用ACT、SmolVLA与π0训练机器人策略，在MuJoCo中做仿真验证并部署到真机。'
)


async def _in_process(function, *args, **kwargs):
    return function(*args, **kwargs)


class EvidenceStrategyTests(unittest.TestCase):
    def test_vla_resume_keeps_model_versions_without_inventing_other_skills(self):
        generated = generate_local_strategy(RESUME, direction_id='robot_vla')
        strategy = generated['draftStrategy']
        self.assertIn('π0.5', strategy['preferredSkills'])
        self.assertIn('π0', strategy['preferredSkills'])
        self.assertNotIn('Sim2Real', strategy['preferredSkills'])
        self.assertTrue(all('强化学习算法' not in term for term in strategy['searchKeywords']))
        self.assertNotIn('强化学习', strategy['scoring']['title_medium_keywords'])
        self.assertTrue(any('π0.5' in item for item in generated['profile']['experienceHighlights']))

    def test_pure_rl_job_ranks_below_vla_with_rl_job(self):
        scoring = generate_local_strategy(RESUME, direction_id='robot_vla')['draftStrategy']['scoring']
        vla = evaluateJobMatch('# 职位名称\nVLA算法工程师\n\n# 职位描述\nπ0.5机械臂策略训练与在线强化学习', scoring)
        pure_rl = evaluateJobMatch('# 职位名称\n强化学习算法工程师\n\n# 职位描述\nPPO奖励建模与策略训练', scoring)
        self.assertGreater(vla['score'], pure_rl['score'])
        self.assertGreaterEqual(vla['score'], 80)
        self.assertLess(pure_rl['score'], 60)

    def test_pi_zero_keyword_does_not_match_pi_zero_point_five(self):
        scoring = {
            'title_strong_keywords': {'VLA': 80},
            'detail_infra_keywords': {'π0': 15},
            'explicit_vla_keywords': ['π0'],
        }
        result = evaluateJobMatch('# 职位名称\nVLA工程师\n\n# 职位描述\n使用π0.5训练', scoring)
        self.assertEqual(result['detail_infra_matches'], [])
        self.assertEqual(result['explicit_vla_matches'], [])

    def test_agent_mode_analyzes_text_locally_and_reuses_local_strategy(self):
        resume = {'kind': 'text', 'text': RESUME, 'record': {'name': 'resume.pdf'}}
        with patch.object(main, 'get_resume_for_agent', return_value=resume), \
             patch.object(main, 'get_resume_text_local', return_value=resume), \
             patch.object(main.asyncio, 'to_thread', side_effect=_in_process), \
             patch.object(main, 'get_agent', side_effect=AssertionError('text analysis must stay local')), \
             patch.object(main, 'save_product_config', return_value={}):
            analyzed = asyncio.run(main.api_agent_analyze_resume({'resumeId': 'sample'}))
        draft = analyzed['draftStrategy']
        self.assertIn('π0.5', draft['preferredSkills'])
        self.assertNotIn('Sim2Real', draft['preferredSkills'])
        self.assertEqual([item['id'] for item in analyzed['questions']],
                         ['targetRoles', 'preferredSkills', 'excludedKeywords'])
        self.assertEqual(analyzed['recommendedDirectionId'], 'robot_vla')
        self.assertIn('robot_vla', [item['id'] for item in analyzed['candidateDirections']])
        saved = {'mode': 'agent', 'strategy': draft, 'candidateProfile': analyzed['profile'],
                 'agentQuestions': analyzed['questions']}
        with patch.object(main, 'get_product_config', return_value=saved), \
             patch.object(main, 'get_resume_for_agent', return_value=resume), \
             patch.object(main, 'get_resume_text_local', return_value=resume), \
             patch.object(main.asyncio, 'to_thread', side_effect=_in_process), \
             patch.object(main, 'get_agent', side_effect=AssertionError('strategy generation must stay local')), \
             patch.object(main, 'save_product_config', return_value={}):
            final = asyncio.run(main.api_agent_build_strategy({'answers': {
                'targetRoles': 'VLA算法实习生', 'preferredSkills': 'π0.5，Sim2Real',
            }}))
        self.assertEqual(final['searchKeywords'], ['VLA算法实习生'])
        self.assertIn('π0.5', final['preferredSkills'])
        self.assertNotIn('Sim2Real', final['preferredSkills'])
        self.assertIn('Sim2Real', final['ignoredPreferredSkills'])
        self.assertNotIn('强化学习', final['scoring']['title_medium_keywords'])

    def test_agent_mode_respects_explicit_direction_selection(self):
        resume = {'kind': 'text', 'text': RESUME, 'record': {'name': 'resume.pdf'}}
        saved = {'mode': 'agent', 'strategy': {'resumeId': 'sample', 'directionId': 'robot_vla'}}
        with patch.object(main, 'get_product_config', return_value=saved), \
             patch.object(main, 'get_resume_for_agent', return_value=resume), \
             patch.object(main.asyncio, 'to_thread', side_effect=_in_process), \
             patch.object(main, 'save_product_config', return_value={}) as save:
            final = asyncio.run(main.api_agent_build_strategy({
                'directionId': 'backend', 'answers': {'preferredSkills': 'π0.5'},
            }))
        self.assertEqual(final['directionId'], 'backend')
        self.assertIn('后端开发工程师', final['searchKeywords'])
        self.assertNotIn('VLA算法工程师', final['searchKeywords'])
        self.assertNotIn('π0.5', final['preferredSkills'])
        self.assertIn('后端开发', save.call_args.args[0]['candidateProfile']['summary'])

    def test_image_transcription_preserves_model_version_before_local_generation(self):
        image = {'kind': 'image', 'dataUrl': 'data:image/png;base64,AAAA'}
        with patch.object(agent_service.QwenAgent, '__init__', return_value=None), \
             patch.object(agent_service.QwenAgent, '_request', return_value={'text': RESUME}):
            text = agent_service.QwenAgent().extract_resume_text(image)
        self.assertIn('π0.5', text)
        strategy = generate_local_strategy(text, direction_id='robot_vla')['draftStrategy']
        self.assertIn('π0.5', strategy['preferredSkills'])

    def test_confirming_agent_strategy_does_not_promote_rl_skill_to_title(self):
        draft = generate_local_strategy(RESUME, direction_id='robot_vla')['draftStrategy']
        draft.update({'source': 'agent', 'confirmed': False})
        config = {'mode': 'agent', 'strategy': draft}
        with patch.object(main, 'get_product_config', return_value=config), \
             patch.object(main, 'save_product_config', side_effect=lambda value, **_: value):
            final = asyncio.run(main.api_confirm_strategy({}))['strategy']
        self.assertNotIn('在线强化学习', final['scoring']['title_medium_keywords'])
        self.assertIn('在线强化学习', final['scoring']['detail_infra_keywords'])

    def test_deleting_image_resume_also_deletes_local_ocr_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'resumes'
            root.mkdir()
            image = root / 'sample.png'
            cache = root / 'sample.ocr.txt'
            image.write_bytes(b'image')
            cache.write_text('private resume text', encoding='utf-8')
            record = {'id': 'sample', 'path': 'resumes/sample.png', 'extension': '.png'}
            with patch.object(resume_service, 'RESUME_DIR', root), \
                 patch.object(resume_service, 'get_resume_record', return_value=record), \
                 patch.object(resume_service, 'delete_resume_record'):
                resume_service.delete_resume('sample')
            self.assertFalse(image.exists())
            self.assertFalse(cache.exists())


if __name__ == '__main__':
    unittest.main()
