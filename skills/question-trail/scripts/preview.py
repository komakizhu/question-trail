#!/usr/bin/env python3
"""题迹：preview 命令入口。"""
import sys
from pathlib import Path
from question_trail import main

# 避免 inspect.py 遮挡 Python 标准库同名模块。
sys.path = [entry for entry in sys.path if Path(entry).resolve() != Path(__file__).resolve().parent]

if __name__ == '__main__':
    raise SystemExit(main('preview'))
