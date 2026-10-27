#!/usr/bin/env python3
"""题迹：仅处理显式文件与题目范围，全部使用 Python 标准库。"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

KINDS = ('单选', '多选', '判断', '主观题')
HEADER = re.compile(r'^>\s*\[!exam-question\][+-]?\s*(.*)$')
ID = re.compile(r'^\^([A-Za-z0-9_-]+)\s*$')
TYPE = re.compile(r'^题型[：:]\s*(.*?)\s*$')
OPTION = re.compile(r'^ {0,3}([A-Z])[.．、)）]\s*(.*)$')


def visible_lines(lines, state=None):
    """跳过代码、表格与独立公式中的伪选项，保留原行号。"""
    fence = None
    math = False
    for index, original in enumerate(lines):
        line = re.sub(r'^> ?', '', original.rstrip('\r\n'))
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not marker[2].strip():
                fence = None
            continue
        if fence:
            continue
        if line.strip() in (r'\[', r'\]') or re.match(r'^\s*\$\$', line):
            if not re.match(r'^\s*\$\$.+\$\$\s*$', line):
                math = not math
            continue
        if math or re.match(r'^(?: {4}|\t)', line) or line.lstrip().startswith('|') or re.match(r'^\s*\$\$.*\$\$\s*$', line):
            continue
        yield index, line
    if state is not None:
        state.update(fence=fence, math=math)


def question_blocks(source):
    lines = source.splitlines(keepends=True)
    # Only top-level callout headers; quoted code fences still suppress examples.
    headers = [i for i, _ in visible_lines(lines) if HEADER.match(lines[i].rstrip('\r\n'))]
    blocks = []
    for start in headers:
        end = start + 1
        while end < len(lines) and lines[end].startswith('>'):
            end += 1
        cursor = end
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        block_id = ID.match(lines[cursor].strip()) if cursor < len(lines) else None
        type_index = cursor + 1 if block_id else cursor
        while type_index < len(lines) and not lines[type_index].strip():
            type_index += 1
        kind = TYPE.match(lines[type_index].strip()) if type_index < len(lines) else None
        blocks.append({'start': start, 'end': end, 'id_line': cursor if block_id else None,
                       'id': block_id[1] if block_id else None,
                       'type_line': type_index if kind else None, 'kind': kind[1] if kind else None})
    return lines, blocks


def validate_choices(body, kind):
    if kind == '主观题':
        return []
    state = {}
    choices = [(index, OPTION.match(line)) for index, line in visible_lines(body, state)]
    choices = [(index, match) for index, match in choices if match]
    letters = [match[1] for _, match in choices]
    choice_texts = []
    for position, (index, match) in enumerate(choices):
        end = choices[position + 1][0] if position + 1 < len(choices) else len(body)
        continuation = [re.sub(r'^> ?', '', line.rstrip('\r\n')) for line in body[index + 1:end]]
        choice_texts.append(match[2] + '\n' + '\n'.join(continuation))
    issues = []
    if any(not text.strip() for text in choice_texts):
        issues.append('选项正文不能为空或只有空白，请补齐原文后重新预览')
    plain = [re.sub(r'^> ?', '', line.rstrip('\r\n')) for line in body]
    for index, line in enumerate(plain):
        if index and re.match(r'^\s*:?-{3,}:?\s*\|', line) and '|' in plain[index - 1] and not plain[index - 1].lstrip().startswith('|'):
            issues.append('发现没有行首竖线的表格，请人工确认选项范围后再整理')
    if state.get('fence') or state.get('math'):
        issues.append('代码围栏或公式未闭合，请核对题目范围')
    if not (2 <= len(letters) <= 26) or letters != list('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[:len(letters)]):
        issues.append('选项须为连续且不重复的 A–Z，至少两项；请先人工核对题目范围和选项')
    if kind == '判断' and len(letters) != 2:
        issues.append('判断题必须有两个带 A/B 标识的原文选项，不自动生成判断文字')
    return issues


def transform(source, specifications):
    lines, blocks = question_blocks(source)
    newline = '\r\n' if '\r\n' in source else '\n'
    issues = []
    edits = []
    used = set()
    for _, line in visible_lines(lines):
        found = ID.match(line)
        if found:
            if found[1] in used:
                issues.append('重复块编号：' + found[1])
            used.add(found[1])
    if not isinstance(specifications, list) or any(not isinstance(item, dict) for item in specifications):
        return source, ['每份文件的 spec 必须是题目对象数组']
    specs = {}
    intervals = []
    for item in specifications:
        start, end = item.get('start_line'), item.get('end_line')
        kind = item.get('kind')
        if (not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int)
                or isinstance(end, bool) or not 1 <= start <= end <= len(lines) or kind not in KINDS):
            issues.append('每个题目必须明确给出有效的 start_line、end_line 和中文 kind')
            continue
        if any(start <= right and end >= left for left, right in intervals):
            issues.append('题目范围重叠')
        intervals.append((start, end))
        specs[start - 1] = item
    if issues:
        return source, issues

    def new_id(content):
        stem = 'qt-' + hashlib.sha256(content.encode('utf-8')).hexdigest()[:12]
        candidate, number = stem, 2
        while candidate in used:
            candidate = stem + '-' + str(number)
            number += 1
        used.add(candidate)
        return candidate

    for block in blocks:
        start, end = block['start'], block['end']
        item = specs.pop(start, None)
        if item and item['end_line'] != end:
            issues.append(f'第 {start + 1} 行：已有卡片范围必须只包含卡片正文，结束行应为 {end}')
            continue
        boundary = end
        while boundary < len(lines) and not re.match(r'^#{1,6}\s|^>\s*\[!exam-(?:question|material)\]', lines[boundary]):
            boundary += 1
        declarations = [index for index in range(end, boundary) if TYPE.match(lines[index].strip())]
        if len(declarations) > 1 or (declarations and declarations != [block['type_line']]):
            issues.append(f'第 {start + 1} 行：题型重复或不紧接块编号，请人工核对')
        if block['id_line'] is not None and block['id_line'] - end > 3:
            issues.append(f'第 {start + 1} 行：块编号与卡片距离过远，插件不能识别')
        kind = block['kind'] or (item['kind'] if item else None)
        if block['kind'] and item and block['kind'] != item['kind']:
            issues.append(f'第 {start + 1} 行：指定题型与原文不同，请人工核对')
        if kind not in KINDS:
            issues.append(f'第 {start + 1} 行：题型不明确，需在 spec 中指定')
            continue
        issues.extend(f'第 {start + 1} 行：{issue}' for issue in validate_choices(lines[start + 1:end], kind))
        block_id = block['id'] or new_id(''.join(lines[start:end]))
        if block['id_line'] is None and block['type_line'] is not None:
            if block['type_line'] - end > 3:
                issues.append(f'第 {start + 1} 行：题型与卡片距离过远，请人工核对')
            edits.append((block['type_line'], block['type_line'], '^' + block_id + newline))
        elif block['id_line'] is None:
            prefix = '' if end > 0 and lines[end - 1].endswith(('\n', '\r')) else newline
            edits.append((end, end, prefix + newline + '^' + block_id + newline + '题型：' + kind + newline))
        elif block['type_line'] is None:
            index = block['id_line'] + 1
            prefix = '' if lines[index - 1].endswith(('\n', '\r')) else newline
            edits.append((index, index, prefix + '题型：' + kind + newline))

    for start, item in sorted(specs.items()):
        end = item['end_line']
        if any(start < b['end'] and end > b['start'] for b in blocks):
            issues.append(f'第 {start + 1} 行：范围与已有题目交叠')
            continue
        if any(ID.match(line.strip()) or TYPE.match(line.strip()) for line in lines[start:end]):
            issues.append(f'第 {start + 1} 行：原始范围含编号或题型，请先核对，不能重复包裹')
            continue
        kind = item['kind']
        issues.extend(f'第 {start + 1} 行：{issue}' for issue in validate_choices(lines[start:end], kind))
        # 原始范围按说明不包含编号；只接纳紧邻、唯一且明确归属的旧编号。
        boundary = min((other for other in specs if other >= end), default=len(lines))
        for index in range(end, boundary):
            if re.match(r'^#{1,6}\s|^>\s*\[!|^\[\^[^\]]+\]:', lines[index]):
                boundary = index
                break
        following = list(visible_lines(lines[end:boundary]))
        nearby_ids = [(end + offset, ID.match(line)) for offset, line in following if ID.match(line)]
        id_line = nearby_ids[0][0] if len(nearby_ids) == 1 else None
        first_content = end
        while first_content < boundary and not lines[first_content].strip():
            first_content += 1
        if nearby_ids and (len(nearby_ids) != 1 or id_line != first_content or id_line - end > 3):
            issues.append(f'第 {start + 1} 行：范围后块编号归属不明确或不唯一，请人工核对')
            continue
        declared = [(end + offset, TYPE.match(line)) for offset, line in following if TYPE.match(line)]
        if declared and (id_line is None or len(declared) != 1 or declared[0][0] != id_line + 1 or declared[0][1][1] != kind):
            issues.append(f'第 {start + 1} 行：已有题型与指定题型不一致或位置不明确，请人工核对')
            continue
        content = ''.join(lines[start:end])
        block_id = nearby_ids[0][1][1] if id_line is not None else new_id(content)
        quoted = ''.join('> ' + line if line.strip() else '>' + line for line in lines[start:end])
        if not quoted.endswith(('\n', '\r')):
            quoted += newline
        title = item.get('title', f'第 {start + 1} 行题目')
        if not isinstance(title, str) or '\n' in title or '\r' in title:
            issues.append('题目标题必须是单行文字')
            continue
        output = '> [!exam-question] ' + title + newline + quoted
        if id_line is None:
            output += newline + '^' + block_id + newline + '题型：' + kind + newline
        else:
            # 编号留在原位置，包裹后即属于新卡片；旧双链与历史标识不变。
            if id_line == end:
                output += newline
            if not declared:
                prefix = '' if lines[id_line].endswith(('\n', '\r')) else newline
                edits.append((id_line + 1, id_line + 1, prefix + '题型：' + kind + newline))
        edits.append((start, end, output))
    if issues:
        return source, issues
    for start, end, replacement in sorted(edits, reverse=True):
        lines[start:end] = [replacement]
    return ''.join(lines), []


def target_paths(values):
    result = []
    for value in values:
        path = Path(value).expanduser().absolute()
        if path.suffix.lower() != '.md' or not path.is_file() or path.is_symlink():
            raise ValueError(f'只接受明确指定的普通 Markdown 文件，不能是目录或软链接：{path}')
        if path.resolve() != path:
            raise ValueError(f'文件路径含软链接或非规范部分，请使用真实绝对路径：{path}')
        if path in result:
            raise ValueError(f'重复文件：{path}')
        result.append(path)
    return result


def inspect_files(paths):
    files = []
    for path in paths:
        source = path.read_bytes().decode('utf-8')
        lines, blocks = question_blocks(source)
        _, issues = transform(source, [])
        files.append({'path': str(path), 'line_count': len(lines), 'questions': [
            {'start_line': b['start'] + 1, 'end_line': b['end'], 'block_id': b['id'], 'kind': b['kind']}
            for b in blocks], 'ambiguities': issues,
            'source': source, 'note': '原始题目请用 spec 明确行范围、题型；不猜参考答案'})
    return files


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def preview_files(paths, specification):
    if not isinstance(specification, dict):
        raise ValueError('spec 必须是以绝对文件路径为键的 JSON 对象')
    unknown = set(specification) - {str(p) for p in paths}
    if unknown:
        raise ValueError('spec 含未明确选中的路径：' + ', '.join(sorted(unknown)))
    files = []
    for path in paths:
        raw = path.read_bytes()
        source = raw.decode('utf-8')
        proposed, issues = transform(source, specification.get(str(path), []))
        files.append({'path': str(path), 'source': source, 'source_base64': base64.b64encode(raw).decode('ascii'),
                      'proposed': proposed, 'ambiguities': issues, 'changed': proposed != source})
    return {'format': 'question-trail-preview-v1', 'files': files}


def atomic_replace(path, data):
    mode = stat.S_IMODE(path.stat().st_mode)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '.', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def validated_preview(preview):
    if not isinstance(preview, dict) or preview.get('format') != 'question-trail-preview-v1' or not isinstance(preview.get('files'), list) or not preview['files']:
        raise ValueError('不是有效的题迹预览文件')
    seen = set()
    for entry in preview['files']:
        if entry['path'] in seen:
            raise ValueError('预览含重复文件')
        seen.add(entry['path'])
        raw = base64.b64decode(entry['source_base64'], validate=True)
        if raw.decode('utf-8') != entry['source']:
            raise ValueError('预览的原文与原始字节不一致')
        if not isinstance(entry['proposed'], str):
            raise ValueError('预览缺少完整建议文本')
    return preview['files']


def apply_preview(preview, confirmed=False):
    if not confirmed:
        raise ValueError('需要用户确认整批预览后传入 --confirm')
    entries = validated_preview(preview)
    if any(entry['ambiguities'] for entry in entries):
        raise ValueError('整批预览仍有未解决歧义，请先重新预览')
    results = []
    stopped = False
    for entry in entries:
        path = Path(entry['path'])
        if stopped:
            results.append({'path': str(path), 'status': 'skipped', 'reason': '前一文件源文变化或写入失败，需重新预览剩余文件'})
            continue
        try:
            target_paths([str(path)])
            if entry['ambiguities']:
                raise ValueError('存在未解决歧义，请先重新预览')
            original = base64.b64decode(entry['source_base64'], validate=True)
            if path.read_bytes() != original:
                raise ValueError('源文已变化，停止本批操作，请重新预览')
            proposed = entry['proposed'].encode('utf-8')
            _, issues = transform(entry['proposed'], [])
            if issues:
                raise ValueError('建议文本验证失败：' + '; '.join(issues))
            if proposed == original:
                results.append({'path': str(path), 'status': 'unchanged'})
                continue
            # 在实际替换前再检查一次；外部编辑器仍应在本批应用时暂停写入。
            if path.read_bytes() != original:
                raise ValueError('写入前源文已变化，请重新预览')
            atomic_replace(path, proposed)
            results.append({'path': str(path), 'status': 'applied'})
        except (OSError, ValueError, UnicodeError) as error:
            results.append({'path': str(path), 'status': 'failed', 'reason': str(error)})
            stopped = True
    return results


def verify_files(paths, preview=None):
    expected = {entry['path']: entry['proposed'] for entry in validated_preview(preview)} if preview else {}
    if preview and set(expected) != {str(path) for path in paths}:
        raise ValueError('验证文件必须与预览中的显式文件完全一致')
    reports = []
    for path in paths:
        source = path.read_bytes().decode('utf-8')
        proposed, issues = transform(source, [])
        if proposed != source:
            issues.append('仍需要整理编号或题型')
        if preview and source != expected[str(path)]:
            issues.append('文件与已确认预览的建议文本不同')
        reports.append({'path': str(path), 'status': 'failed' if issues else 'verified', 'issues': issues,
                        'question_count': len(question_blocks(source)[1])})
    return reports


def main(command=None):
    # inspect.py 不能遮挡 argparse 间接使用的标准库 inspect。
    sys.path = [entry for entry in sys.path if Path(entry).resolve() != Path(__file__).resolve().parent]
    parser = argparse.ArgumentParser(description='题迹：检查、预览、确认应用和验证 Markdown 题目')
    if command is None:
        parser.add_argument('command', choices=('inspect', 'preview', 'apply', 'verify'))
    else:
        parser.set_defaults(command=command)
    parser.add_argument('--files', nargs='+', help='显式的 Markdown 文件路径；不接受目录或通配符')
    parser.add_argument('--spec', help='逐文件题目行范围和中文题型 JSON')
    parser.add_argument('--output', help='预览 JSON 保存路径，不得覆盖输入文件')
    parser.add_argument('--preview', help='已检查并经用户确认的预览 JSON')
    parser.add_argument('--confirm', action='store_true', help='仅在用户一次确认整批预览后使用')
    args = parser.parse_args()
    try:
        if args.command == 'apply':
            if not args.preview:
                raise ValueError('apply 必须指定 --preview')
            result = apply_preview(read_json(args.preview), args.confirm)
        else:
            if not args.files:
                raise ValueError('必须通过 --files 明确指定 Markdown 文件')
            paths = target_paths(args.files)
            if args.command == 'inspect':
                result = inspect_files(paths)
            elif args.command == 'preview':
                if not args.output:
                    raise ValueError('preview 必须指定 --output，以便确认完整原文和建议文本')
                output = Path(args.output).expanduser().absolute()
                if output in paths or output.suffix.lower() == '.md' or output.exists():
                    raise ValueError('预览输出必须是尚不存在的 JSON 文件，不能覆盖 Markdown 或已有文件')
                result = preview_files(paths, read_json(args.spec) if args.spec else {})
                with output.open('x', encoding='utf-8') as handle:
                    json.dump(result, handle, ensure_ascii=False, indent=2)
                    handle.write('\n')
            else:
                result = verify_files(paths, read_json(args.preview) if args.preview else None)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if isinstance(result, list):
            return 1 if any(item.get('status') in ('failed', 'skipped') for item in result) else 0
        return 1 if any(item['ambiguities'] for item in result['files']) else 0
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
