"""python -m backend.eval.parser_bench <tools|install|clear-models|run|models|runs|export|select|compare|serve>

    tools                         list methods and whether each is ready
    install <tool>                create a method's own environment
    clear-models <tool> [--force] delete a heavy method's downloaded models (its environment and runs stay);
                                  a method whose models come only from install (mineru, marker, paddleocr)
                                  is refused unless --force
    run <tool> <pdf> [--pages 1,4-6] [--purpose explore|benchmark] [--no-warmup] [--cost-ok]
                                  a paid method prints its page count and cost and needs --cost-ok
    models                        the OpenAI model ids this account can use (for choosing ai_vision_strong)
    runs                          list every run, newest first
    export <run_id>               copy a benchmark run's numbers into the repo
    select show <source>          each page's title and structure, to choose pages (local only)
    select draw <chosen.json> --seed N [--out pages.json]
                                  keep the chosen pages, draw 2 more per source, write the page set
    compare create --tools a,b,c --seed N [--against cmp-…[,cmp-…] [--opponents x,y]]
                                  a blind comparison of those methods' benchmark runs; with --against, the
                                  methods are added to finished comparisons (only their pairs, one scale);
                                  with --opponents, they meet each other and only those earlier methods
    compare status [<cmp_id>]     judging progress; the ranking once judging is finished
    serve [--port 8766]           the webpage, on 127.0.0.1 only
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from backend.eval.parser_bench import blinding, compare, execute, pageset, paid, results, server, sources, store, tools


def _pages(spec: str) -> list[int]:
    pages: list[int] = []
    for part in spec.split(","):
        first, _, last = part.partition("-")
        start, end = int(first), int(last or first)
        if end < start:
            raise argparse.ArgumentTypeError(f"page range {part!r} runs backwards")
        pages += list(range(start, end + 1))
    return pages


def _shown(value: object) -> str:
    """A measured number, or a dash where none was measured (never the word None)."""
    return "—" if value is None else str(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.eval.parser_bench")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tools", help="list methods and whether each is ready")
    p = sub.add_parser("install", help="create a method's own environment")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
    p = sub.add_parser("clear-models", help="delete a heavy method's downloaded models (environment and runs stay)")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
    p.add_argument("--force", action="store_true",
                   help="clear a method whose models come only from install; run install again afterwards")
    p = sub.add_parser("run", help="run one method on one PDF")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
    p.add_argument("pdf", type=Path)
    p.add_argument("--pages", type=_pages, help="e.g. 1,4-6 (default: every page)")
    p.add_argument("--purpose", choices=store.PURPOSES, default="explore")
    p.add_argument("--no-warmup", action="store_true", help="skip the two-page warm-up run")
    p.add_argument("--cost-ok", action="store_true", help="a paid method: send the pages and pay for them")
    sub.add_parser("runs", help="list every run, newest first")
    sub.add_parser("models", help="the OpenAI model ids this account can use")
    p = sub.add_parser("export", help="copy a benchmark run's numbers into the repo")
    p.add_argument("run_id")
    p = sub.add_parser("select", help="choose and freeze the benchmark page set")
    select = p.add_subparsers(dest="action", required=True)
    s = select.add_parser("show", help="each page's title and structure (printed here, never committed)")
    s.add_argument("source", choices=[src.id for src in sources.BENCHMARK_SOURCES])
    s = select.add_parser("draw", help="keep the chosen pages and draw 2 more per source")
    s.add_argument("chosen", type=Path, help="JSON: {source id: [{file, page, type, reason}, ×4]}")
    s.add_argument("--seed", type=int, required=True)
    s.add_argument("--out", type=Path, default=pageset.PAGESET)
    p = sub.add_parser("compare", help="blind comparisons of benchmark runs")
    cmp_sub = p.add_subparsers(dest="action", required=True)
    s = cmp_sub.add_parser("create", help="a new comparison of these methods' latest benchmark runs")
    s.add_argument("--tools", required=True, help="comma-separated method ids, e.g. current,pdfjs")
    s.add_argument("--seed", type=int, required=True)
    s.add_argument("--against", help="comma-separated finished comparisons to add the methods to")
    s.add_argument("--opponents", help="comma-separated earlier methods the new ones meet (with --against)")
    s = cmp_sub.add_parser("status", help="progress, and the ranking once judging is finished")
    s.add_argument("cmp_id", nargs="?")
    p = sub.add_parser("serve", help="the webpage on 127.0.0.1")
    p.add_argument("--port", type=int, default=server.DEFAULT_PORT)
    args = parser.parse_args(argv)

    if args.cmd == "tools":
        for tool in tools.TOOLS.values():
            gaps = tools.missing(tool)
            state = "ready" if not gaps else "needs " + "; ".join(gaps)
            models = f"  models {_shown(tools.cache_mb(tool))} MB" if tool.downloads_models else ""
            print(f"{tool.id:15} {tool.group:6} {state}{models}")
        return 0

    if args.cmd == "clear-models":
        tool = tools.TOOLS[args.tool]
        try:
            freed = tools.clear_models(tool, force=args.force)
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        print(f"{args.tool}: {freed / 2**20:.0f} MB of models deleted; {tools.clear_note(tool)}")
        return 0

    if args.cmd == "install":
        try:
            print("\n".join(tools.install(tools.TOOLS[args.tool])))
        except (tools.DiskSpaceError, tools.ToolNotReady) as e:
            print(e, file=sys.stderr)
            return 2
        except subprocess.CalledProcessError as e:
            program = Path(str(e.cmd[0] if isinstance(e.cmd, (list, tuple)) else e.cmd)).name
            print(f"install {args.tool} failed: {program} exited with code {e.returncode}", file=sys.stderr)
            return 2
        except OSError as e:  # e.g. node or java is not on PATH
            print(f"install {args.tool} failed: {e}", file=sys.stderr)
            return 2
        return 0

    if args.cmd == "run":
        tool = tools.TOOLS[args.tool]
        if tool.paid:
            try:
                est = paid.estimate(tool.model, len(execute.planned_pages(args.pdf, args.pages, args.purpose)))
            except (ValueError, OSError, RuntimeError) as e:
                print(e, file=sys.stderr)
                return 2
            print(est.line(tool.id))
            if not args.cost_ok:
                print("nothing sent; add --cost-ok to send these page images to OpenAI and pay for them", file=sys.stderr)
                return 2
        try:
            run = execute.run_tool(args.tool, args.pdf, pages=args.pages, purpose=args.purpose,
                                   warmup=not args.no_warmup, cost_ok=args.cost_ok)
        except (RuntimeError, ValueError) as e:
            print(e, file=sys.stderr)
            return 2
        meta = run.meta
        detail = meta.get("reason") or (
            f"{_shown(meta.get('seconds_per_page'))} s/page, peak {_shown(meta.get('peak_memory_mb'))} MB"
        )
        print(f"{meta['run_id']}  {meta['status']}  {detail}")
        print(run.path)
        return 0 if meta["status"] == "finished" else 1

    if args.cmd == "runs":
        try:
            metas = store.list_runs()
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        for meta in metas:
            print(f"{meta['run_id']:46} {meta.get('tool', ''):15} {meta.get('status', ''):9} "
                  f"{meta.get('purpose', ''):9} {_shown(meta.get('seconds_per_page'))} s/page  "
                  f"peak {_shown(meta.get('peak_memory_mb'))} MB")
        return 0

    if args.cmd == "models":
        try:
            print("\n".join(paid.list_models()))
        except RuntimeError as e:  # KeyFileError is a RuntimeError too
            print(e, file=sys.stderr)
            return 2
        return 0

    if args.cmd == "export":
        try:
            print(store.export_run(args.run_id))
        except (ValueError, FileNotFoundError) as e:
            print(e, file=sys.stderr)
            return 2
        return 0
    if args.cmd == "select":
        return _select(args)
    if args.cmd == "compare":
        return _compare(args)
    if args.cmd == "serve":
        print(f"Parser Bench on http://{server.HOST}:{args.port}  (Ctrl-C stops it)")
        server.serve(args.port)
        return 0
    return 2


def _select(args: argparse.Namespace) -> int:
    if args.action == "show":
        source = next(s for s in sources.BENCHMARK_SOURCES if s.id == args.source)
        for name, path in zip(source.files, source.paths()):
            if not path.exists():
                print(f"{path} is missing", file=sys.stderr)
                return 2
            print(f"# {name}  ({sources.page_count(path)} pages)")
            print(f"{'page':>4}  {'lines':>5} {'words':>5} {'img':>3} {'draw':>4} sym  title")
            for row in pageset.describe(path):
                print(f"{row['page']:>4}  {row['lines']:>5} {row['words']:>5} {row['images']:>3} {row['drawings']:>4} "
                      f"{'yes' if row['symbol_font'] else '   '}  {row['title'][:60]}")
        return 0
    try:
        chosen = json.loads(args.chosen.read_text(encoding="utf-8"))
        data = pageset.draw(chosen, args.seed)
    except (OSError, ValueError, KeyError) as e:
        print(e, file=sys.stderr)
        return 2
    print(pageset.write(data, args.out))
    for page in data["pages"]:
        if page["how"] == "random":
            print(f"drawn: {page['key']}  ({page['file']} page {page['page']}): tag its type in the file")
    return 0


def _compare(args: argparse.Namespace) -> int:
    if args.action == "create":
        try:
            gate = execute.benchmark_gate()
            chosen = [t for t in args.tools.split(",") if t]
            rivals = [t for t in args.opponents.split(",") if t] if args.opponents is not None else None
            if args.against:
                cmp = compare.create_pooled(chosen, against=[c for c in args.against.split(",") if c], seed=args.seed,
                                            commit=gate["protocol_commit"], tree=gate["bench_tree"], opponents=rivals)
            elif rivals is not None:
                raise ValueError("--opponents needs --against: only an added comparison has opponents")
            else:
                cmp = compare.create_benchmark(chosen, seed=args.seed, commit=gate["protocol_commit"], tree=gate["bench_tree"])
        except (RuntimeError, ValueError, FileNotFoundError) as e:
            print(e, file=sys.stderr)
            return 2
        done, total = cmp.progress()
        print(f"{cmp.run_id}  judging  {done}/{total} duels")
        print(cmp.path)
        return 0
    try:
        found = compare.list_comparisons()
        cmp = compare.CompareRun.open(args.cmp_id) if args.cmp_id else (found[0] if found else None)
    except (ValueError, FileNotFoundError) as e:
        print(e, file=sys.stderr)
        return 2
    if cmp is None:
        print("no comparison yet", file=sys.stderr)
        return 2
    meta = cmp.meta
    done, total = cmp.progress()
    locked = blinding.comparison_locked(meta)
    print(f"{cmp.run_id}  {meta['status']}  {done}/{total} duels" + ("" if locked else f"  round {meta['rounds']}"))
    if locked:
        print("names and ranking stay hidden until judging is finished")
        return 0
    data = results.current_results(cmp)
    for row in data["ranking"]:
        print(f"{row['entrant']:15} {row['points']:7.1f}  ({row['lo']:.1f}–{row['hi']:.1f})  {row['duels']} duels")
    sc = data["self_consistency"]
    print(f"self-consistency {sc['agree']}/{sc['total']}  median decision {data['median_seconds']} s  "
          f"H1 {'holds' if data['h1']['holds'] else 'does not hold'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
