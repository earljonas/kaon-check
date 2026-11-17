"""Reproduce exact-byte split overlap counts; this does not screen near-duplicates.

Usage: python tools/audit_dataset.py dataset
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path


def audit(root):
    groups = defaultdict(list)
    for split in ("train", "valid", "test"):
        directory = root / split / "images"
        if not directory.is_dir():
            raise ValueError(f"Missing split: {directory}")
        for path in directory.iterdir():
            if path.is_file():
                groups[hashlib.sha256(path.read_bytes()).hexdigest()].append(split)
    cross = [g for g in groups.values() if len(set(g)) > 1]
    return {
        "algorithm": "SHA-256 exact file bytes",
        "cross_split_duplicate_groups": len(cross),
        "validation_images_matching_train": sum(g.count("valid") for g in cross if "train" in g),
        "test_images_matching_train_or_validation": sum(g.count("test") for g in cross if "train" in g or "valid" in g),
        "near_duplicates_screened": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.dataset), indent=2))
