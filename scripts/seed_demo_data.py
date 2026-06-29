from pathlib import Path
import runpy


ROOT = Path(__file__).resolve().parents[1]
runpy.run_path(str(ROOT / "apps" / "api" / "scripts" / "seed_demo_data.py"), run_name="__main__")

