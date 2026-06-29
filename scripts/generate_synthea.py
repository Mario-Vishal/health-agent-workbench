from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / ".cache" / "synthea"
DEFAULT_OUTPUT = ROOT / "data" / "synthea" / "fhir"
SYNTHEA_REPO = "https://github.com/synthetichealth/synthea.git"


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def ensure_synthea_repo(cache_dir: Path) -> None:
    if cache_dir.exists():
        run(["git", "pull", "--ff-only"], cwd=cache_dir)
        return
    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", "--depth", "1", SYNTHEA_REPO, str(cache_dir)])


def clear_json_files(directory: Path) -> None:
    if not directory.exists():
        return
    for bundle in directory.glob("*.json"):
        bundle.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Synthea HL7 FHIR R4 bundles for HealthAgent Workbench.")
    parser.add_argument("--patients", type=int, default=25, help="Number of synthetic patients to generate.")
    parser.add_argument("--state", default="Massachusetts", help="Synthea geography argument.")
    parser.add_argument("--city", default="Boston", help="Synthea city argument.")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE, help="Local Synthea checkout cache.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="FHIR bundle output directory.")
    args = parser.parse_args()

    if not shutil.which("git"):
        raise SystemExit("git is required to clone/update Synthea.")
    if not shutil.which("java"):
        raise SystemExit("Java is required to run Synthea.")

    ensure_synthea_repo(args.cache_dir)
    args.output.mkdir(parents=True, exist_ok=True)
    fallback_output = args.cache_dir / "output" / "fhir"
    clear_json_files(args.output)
    clear_json_files(fallback_output)

    gradlew = args.cache_dir / "gradlew.bat" if os.name == "nt" and (args.cache_dir / "gradlew.bat").exists() else args.cache_dir / "gradlew"
    if os.name != "nt" and gradlew.exists():
        gradlew.chmod(gradlew.stat().st_mode | 0o111)
    run(
        [
            str(gradlew),
            "run",
            f"-Dexporter.baseDirectory={args.output.parent.resolve()}",
            "-Dexporter.fhir.export=true",
            "-Dexporter.fhir_stu3.export=false",
            "-Dexporter.ccda.export=false",
            "-Dexporter.csv.export=false",
            "-Dexporter.text.export=false",
            f"--args=-p {args.patients} {args.state} {args.city}",
        ],
        cwd=args.cache_dir,
    )

    generated = next(
        (
            candidate
            for candidate in (args.output, args.output.parent / "fhir", fallback_output)
            if candidate.exists() and any(candidate.glob("*.json"))
        ),
        args.output,
    )
    if generated.resolve() != args.output.resolve():
        args.output.mkdir(parents=True, exist_ok=True)
        for bundle in generated.glob("*.json"):
            shutil.copy2(bundle, args.output / bundle.name)

    bundle_count = len(list(args.output.glob("*.json")))
    print(f"Synthea FHIR bundles written to {args.output} ({bundle_count} files)")


if __name__ == "__main__":
    main()
