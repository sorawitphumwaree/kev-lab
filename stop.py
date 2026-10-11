"""Stop only Python processes running this lab's exact entry point."""
from pathlib import Path
import psutil

root = Path(__file__).resolve().parent
target = str(root / "lab.py").casefold()
targets = []
failed = []
for process in psutil.process_iter(["cmdline", "exe"]):
    matched = False
    try:
        args = process.info["cmdline"] or []
        exe = process.info["exe"] or ""
        if exe.casefold().startswith(str(root).casefold() + "\\") and any(arg.casefold() == target for arg in args):
            matched = True
            process.terminate()
            targets.append(process)
    except psutil.NoSuchProcess:
        continue
    except psutil.AccessDenied:
        # Unrelated system processes may be inaccessible during enumeration.
        if matched:
            failed.append(process.pid)
_, alive = psutil.wait_procs(targets, timeout=5)
if alive or failed:
    raise SystemExit("Some lab processes could not be stopped. Close their console and retry.")
print(f"Stopped {len(targets)} local playground process(es).")
