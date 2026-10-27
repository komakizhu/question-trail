import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('question_trail', ROOT / 'scripts/question_trail.py')
qt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qt)


class MetadataTests(unittest.TestCase):
    def test_exact_v5_metadata_and_local_resources(self):
        import json
        import re
        text = (ROOT / 'SKILL.md').read_text()
        self.assertTrue(text.startswith('---\nname: question-trail\n'))
        description = text.split('description: ', 1)[1].split('\n---', 1)[0]
        self.assertRegex(description, '[\u4e00-\u9fff]')
        self.assertIn('Use this skill when', description)
        ui = (ROOT / 'agents/openai.yaml').read_text()
        values = {key: json.loads(value) for key, value in re.findall(r'^  (\w+): (.+)$', ui, re.M)}
        self.assertTrue(ui.startswith('interface:\n'))
        self.assertEqual(values['display_name'], '题迹（Question Trail）')
        self.assertTrue(25 <= len(values['short_description']) <= 64)
        self.assertIn('$question-trail', values['default_prompt'])
        for resource in re.findall(r'\]\(([^)]+)\)', text):
            self.assertTrue((ROOT / resource).is_file(), resource)
        for command in ('inspect', 'preview', 'apply', 'verify'):
            self.assertTrue((ROOT / 'scripts' / (command + '.py')).is_file())


class FormatTests(unittest.TestCase):
    def test_explicit_raw_conversion_preserves_text_and_is_idempotent(self):
        source = '# 原笔记\n题干\nA. 甲\nB. 乙\n\n原注释\n'
        result, issues = qt.transform(source, [{'start_line': 2, 'end_line': 4, 'kind': '单选'}])
        self.assertEqual(issues, [])
        self.assertIn('> 题干\n> A. 甲\n> B. 乙', result)
        self.assertIn('题型：单选', result)
        self.assertTrue(result.endswith('\n原注释\n'))
        again, issues = qt.transform(result, [])
        self.assertEqual((again, issues), (result, []))

    def test_raw_question_reuses_adjacent_existing_id(self):
        body = '题干\nA. 甲\nB. 乙\n'
        for separator in ('', '\n', '\r\n'):
            source = body + separator + '^existing-question\n标签：原标签\n关联：[[#^existing-question]]\n'
            output, issues = qt.transform(source, [{'start_line': 1, 'end_line': 3, 'kind': '单选'}])
            self.assertEqual(issues, [])
            self.assertEqual([q['id'] for q in qt.question_blocks(output)[1]], ['existing-question'])
            self.assertNotIn('^qt-', output)
            self.assertIn('^existing-question\n题型：单选', output)
            self.assertIn('关联：[[#^existing-question]]', output)
            self.assertEqual(qt.transform(output, []), (output, []))

    def test_raw_question_reuses_existing_id_and_kind_without_duplicate(self):
        source = '题干\nA. 甲\nB. 乙\n\n^existing-question\n题型：单选\n标签：保留\n'
        output, issues = qt.transform(source, [{'start_line': 1, 'end_line': 3, 'kind': '单选'}])
        self.assertEqual(issues, [])
        self.assertEqual(output.count('题型：单选'), 1)
        self.assertEqual([q['id'] for q in qt.question_blocks(output)[1]], ['existing-question'])
        self.assertEqual(qt.transform(output, []), (output, []))
        unchanged, issues = qt.transform(source, [{'start_line': 1, 'end_line': 3, 'kind': '多选'}])
        self.assertTrue(issues)
        self.assertEqual(unchanged, source)

    def test_raw_question_ambiguous_or_duplicate_id_is_blocked(self):
        body = '题干\nA. 甲\nB. 乙\n'
        for tail in ('\n^one\n^two\n', '\n说明归属不明\n^one\n', '\n\n\n\n^one\n', '\n^one\n\n^one\n'):
            source = body + tail
            output, issues = qt.transform(source, [{'start_line': 1, 'end_line': 3, 'kind': '单选'}])
            self.assertTrue(issues, tail)
            self.assertEqual(output, source)

    def test_whitespace_only_options_rejected_in_raw_and_existing_cards(self):
        for empty in ('', ' ', '   ', '\t', '\u3000'):
            body = f'题干\nA. {empty}\nB. 乙\n'
            self.assertTrue(qt.transform(body, [{'start_line': 1, 'end_line': 3, 'kind': '单选'}])[1], repr(empty))
            source = '> [!exam-question] 一\n' + ''.join('> ' + line for line in body.splitlines(keepends=True)) + '\n^one\n题型：单选\n'
            self.assertTrue(qt.transform(source, [])[1], repr(empty))

    def test_multiline_option_text_is_valid_but_empty_option_is_rejected(self):
        body = '题干\nA. \n  甲选项的续行\nB. 乙\n'
        output, issues = qt.transform(body, [{'start_line': 1, 'end_line': 4, 'kind': '单选'}])
        self.assertEqual(issues, [])
        self.assertIn('> A. \n>   甲选项的续行\n> B. 乙', output)
        empty, issues = qt.transform('题干\nA. \nB. 乙\n', [{'start_line': 1, 'end_line': 3, 'kind': '单选'}])
        self.assertTrue(issues)
        self.assertEqual(empty, '题干\nA. \nB. 乙\n')
        for content in ('$$\nx+1\n$$', '```text\n代码选项\n```', '| 表格选项 |'):
            with self.subTest(content=content):
                source = '题干\nA. \n' + content + '\nB. 乙\n'
                _, issues = qt.transform(source, [{'start_line': 1, 'end_line': len(source.splitlines()), 'kind': '单选'}])
                self.assertEqual(issues, [])

    def test_untyped_and_nonsequential_options_require_resolution(self):
        _, issues = qt.transform('> [!exam-question] 第 1 题\n> 题干\n> A. 甲\n> C. 乙\n', [])
        self.assertTrue(issues)

    def test_subjective_pseudo_choices_are_not_parsed(self):
        source = '> [!exam-question] 写作\n> A. 是正文\n\n^essay\n题型：主观题\n'
        self.assertEqual(qt.transform(source, []), (source, []))

    def test_code_table_and_formula_pseudo_options_are_ignored(self):
        body = '题干\n```text\nC. 假选项\n```\n| D. 表格 |\n$$\nE. 公式\n$$\nA. 甲\nB. 乙\n'
        result, issues = qt.transform(body, [{'start_line': 1, 'end_line': len(body.splitlines()), 'kind': '判断'}])
        self.assertEqual(issues, [])
        self.assertIn('> B. 乙', result)

    def test_indented_code_ignored_and_unclosed_fences_rejected(self):
        source = '题干\n    C. 代码\nA. 甲\nB. 乙\n'
        self.assertEqual(qt.transform(source, [{'start_line': 1, 'end_line': 4, 'kind': '单选'}])[1], [])
        source += '```\n未闭合\n'
        self.assertTrue(qt.transform(source, [{'start_line': 1, 'end_line': 6, 'kind': '单选'}])[1])

    def test_duplicate_and_misplaced_kind_rejected(self):
        source = '> [!exam-question] 一\n> A. 甲\n> B. 乙\n\n^one\n题型：单选\n题型：多选\n'
        self.assertTrue(qt.transform(source, [])[1])
        self.assertTrue(qt.transform(source.replace('题型：单选\n', '标签：原文\n'), [])[1])

    def test_ambiguous_table_and_invalid_closing_fence_blocked(self):
        table = '题干\nA. 表头 | 第二列\n--- | ---\nA. 甲\nB. 乙\n'
        self.assertTrue(qt.transform(table, [{'start_line': 1, 'end_line': 5, 'kind': '单选'}])[1])
        fence = '题干\nA. 甲\nB. 乙\n```\n原文\n```not-a-close\n'
        self.assertTrue(qt.transform(fence, [{'start_line': 1, 'end_line': 6, 'kind': '单选'}])[1])

    def test_existing_kind_without_id_gets_only_one_kind(self):
        source = '> [!exam-question] 一\n> A. 甲\n> B. 乙\n\n题型：单选\n标签：原文\n'
        output, issues = qt.transform(source, [])
        self.assertEqual(issues, [])
        self.assertEqual(output.count('题型：单选'), 1)
        self.assertEqual(qt.transform(output, []), (output, []))

    def test_existing_id_unchanged_and_no_answer_created(self):
        source = '> [!exam-question] 一\n> A. 甲\n> B. 乙\n\n^original-id\n'
        result, issues = qt.transform(source, [{'start_line': 1, 'end_line': 3, 'kind': '多选'}])
        self.assertEqual(issues, [])
        self.assertIn('^original-id\n题型：多选', result)
        self.assertNotIn('参考答案', result)

    def test_duplicate_content_ids_do_not_depend_on_spec_order(self):
        body = '题干\nA. 甲\nB. 乙\n'
        specs = [{'start_line': 1, 'end_line': 3, 'kind': '单选'}, {'start_line': 4, 'end_line': 6, 'kind': '单选'}]
        self.assertEqual(qt.transform(body + body, specs), qt.transform(body + body, list(reversed(specs))))

    def test_full_alphabet_and_duplicate_content_stable_ids(self):
        body = '题干\n' + ''.join(f'{letter}. 选项{letter}\n' for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        output, issues = qt.transform(body + body, [{'start_line': 1, 'end_line': 27, 'kind': '多选'}, {'start_line': 28, 'end_line': 54, 'kind': '多选'}])
        self.assertEqual(issues, [])
        ids = [b['id'] for b in qt.question_blocks(output)[1]]
        self.assertEqual(len(set(ids)), 2)
        self.assertEqual(qt.transform(output, []), (output, []))


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.paths = [self.root / name for name in ('a.md', 'b.md', 'c.md')]
        for path in self.paths:
            path.write_text('题干\nA. 正确\nB. 错误\n', encoding='utf-8')
        self.spec = {str(p): [{'start_line': 1, 'end_line': 3, 'kind': '判断'}] for p in self.paths}

    def test_explicit_file_scope_and_atomic_failure_cleanup(self):
        from unittest.mock import patch
        with self.assertRaises(ValueError):
            qt.target_paths([str(self.root)])
        linked = self.root / 'linked.md'
        linked.symlink_to(self.paths[0])
        with self.assertRaises(ValueError):
            qt.target_paths([str(linked)])
        with self.assertRaises(ValueError):
            qt.preview_files(self.paths[:1], self.spec)
        original = self.paths[0].read_bytes()
        with patch.object(qt.os, 'replace', side_effect=OSError('模拟原子替换失败')):
            with self.assertRaises(OSError):
                qt.atomic_replace(self.paths[0], b'new')
        self.assertEqual(self.paths[0].read_bytes(), original)
        self.assertEqual(list(self.root.glob('.*')), [])

    def test_any_unresolved_ambiguity_blocks_entire_batch(self):
        preview = qt.preview_files(self.paths, self.spec)
        preview['files'][1]['ambiguities'] = ['待确认']
        with self.assertRaises(ValueError):
            qt.apply_preview(preview, True)
        self.assertEqual(self.paths[0].read_text(), '题干\nA. 正确\nB. 错误\n')

    def test_confirmation_then_apply_then_verify(self):
        preview = qt.preview_files(self.paths, self.spec)
        with self.assertRaises(ValueError):
            qt.apply_preview(preview)
        self.assertEqual([r['status'] for r in qt.apply_preview(preview, True)], ['applied'] * 3)
        self.assertEqual([r['status'] for r in qt.verify_files(self.paths, preview)], ['verified'] * 3)
        again = qt.preview_files(self.paths, {})
        self.assertFalse(any(e['changed'] for e in again['files']))
        self.assertFalse(any(e['ambiguities'] for e in again['files']))

    def test_source_changed_blocks_current_and_remaining(self):
        preview = qt.preview_files(self.paths, self.spec)
        self.paths[1].write_bytes(b'changed\n')
        result = qt.apply_preview(preview, True)
        self.assertEqual([r['status'] for r in result], ['applied', 'failed', 'skipped'])
        self.assertEqual(self.paths[1].read_bytes(), b'changed\n')
        self.assertEqual(self.paths[2].read_text(), '题干\nA. 正确\nB. 错误\n')

    def test_write_failure_reports_partial_and_cleans_temporary(self):
        from unittest.mock import patch
        preview = qt.preview_files(self.paths, self.spec)
        original = qt.atomic_replace
        def fail_second(path, data):
            if path == self.paths[1]:
                raise OSError('模拟写入失败')
            original(path, data)
        with patch.object(qt, 'atomic_replace', side_effect=fail_second):
            result = qt.apply_preview(preview, True)
        self.assertEqual([r['status'] for r in result], ['applied', 'failed', 'skipped'])
        self.assertEqual(list(self.root.glob('.*')), [])

    def test_crlf_is_byte_exact_in_preview_and_preserved(self):
        path = self.paths[0]
        path.write_bytes('题干\r\nA. 正确\r\nB. 错误\r\n'.encode())
        preview = qt.preview_files([path], {str(path): self.spec[str(path)]})
        self.assertEqual(qt.base64.b64decode(preview['files'][0]['source_base64']), path.read_bytes())
        self.assertEqual(qt.apply_preview(preview, True)[0]['status'], 'applied')
        raw = path.read_bytes()
        self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))

    def test_duplicate_ids_and_ambiguous_types_are_blocked(self):
        source = '> [!exam-question] 一\n> 作文\n\n^same\n题型：主观题\n\n> [!exam-question] 二\n> 作文\n\n^same\n题型：主观题\n'
        self.assertTrue(qt.transform(source, [])[1])
        self.assertTrue(qt.transform('> [!exam-question] 一\n> A. 甲\n> B. 乙\n', [])[1])

    def test_packaged_entrypoints_from_another_directory(self):
        import shutil
        import subprocess
        package = self.root / 'package'
        shutil.copytree(ROOT, package, ignore=shutil.ignore_patterns('__pycache__'))
        import json
        spec_path = self.root / 'spec.json'
        spec_path.write_text(json.dumps(self.spec))
        preview_path = self.root / 'preview.json'
        scripts = package / 'scripts'
        commands = [
            ['inspect.py', '--files', *map(str, self.paths)],
            ['preview.py', '--files', *map(str, self.paths), '--spec', str(spec_path), '--output', str(preview_path)],
            ['apply.py', '--preview', str(preview_path), '--confirm'],
            ['verify.py', '--files', *map(str, self.paths), '--preview', str(preview_path)],
            ['question_trail.py', 'verify', '--files', *map(str, self.paths)],
        ]
        for command in commands:
            done = subprocess.run([qt.sys.executable, str(scripts / command[0]), *command[1:]], cwd=self.root, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr + done.stdout)


if __name__ == '__main__':
    unittest.main()
