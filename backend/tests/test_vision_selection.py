from pathlib import Path

from PIL import Image

from pipeline.vision import (
    _materialize_selected_frames,
    _score_scanned_frames,
    _select_frame_candidates,
)


def _frames(hours: int) -> list[dict]:
    count = hours * 60 * 60
    return [
        {
            "timestamp": float(second) + 0.5,
            "path": f"frame_{second:08d}.jpg",
            "activity": 1.0 if second % 97 == 0 else 0.01,
        }
        for second in range(count)
    ]


def test_three_hour_scan_covers_every_minute_without_exceeding_budget():
    selected = _select_frame_candidates(
        _frames(3), window_seconds=60, max_frames=360
    )

    assert len(selected) == 360
    covered_windows = {int(frame["timestamp"] // 60) for frame in selected}
    assert covered_windows == set(range(180))


def test_five_hour_scan_keeps_timeline_coverage_under_hard_cap():
    selected = _select_frame_candidates(
        _frames(5), window_seconds=60, max_frames=360
    )

    assert len(selected) == 360
    assert selected[0]["timestamp"] < 60
    assert selected[-1]["timestamp"] > (5 * 60 * 60) - 60


def test_selector_keeps_high_activity_frame_and_window_representative():
    frames = [
        {"timestamp": float(i), "path": f"{i}.jpg", "activity": 0.0}
        for i in range(120)
    ]
    frames[42]["activity"] = 1.0

    selected = _select_frame_candidates(frames, window_seconds=60, max_frames=4)
    timestamps = {frame["timestamp"] for frame in selected}

    assert 42.0 in timestamps
    assert any(0 <= timestamp < 60 for timestamp in timestamps)
    assert any(60 <= timestamp < 120 for timestamp in timestamps)


def test_scan_scoring_marks_visual_change(tmp_path: Path):
    paths = []
    for index, color in enumerate((0, 0, 255), start=1):
        path = tmp_path / f"scan_{index:08d}.jpg"
        Image.new("L", (8, 8), color=color).save(path)
        paths.append(str(path))

    scored = _score_scanned_frames(paths, fps=1.0)

    assert [frame["timestamp"] for frame in scored] == [0.5, 1.5, 2.5]
    assert scored[1]["activity"] == 0.0
    assert scored[2]["activity"] > 0.9


def test_selected_candidates_are_reextracted_for_analysis(monkeypatch, tmp_path):
    calls = []

    def fake_sample(video_path, timestamp, output_dir):
        calls.append((video_path, timestamp, output_dir))
        return str(tmp_path / f"selected-{timestamp}.jpg")

    monkeypatch.setattr("pipeline.vision._sample_frame", fake_sample)
    candidates = [
        {"timestamp": 30.5, "path": "scan-a.jpg", "activity": 0.1},
        {"timestamp": 90.5, "path": "scan-b.jpg", "activity": 0.8},
    ]

    selected = _materialize_selected_frames(
        "vod.mp4", candidates, str(tmp_path / "selected")
    )

    assert [frame["timestamp"] for frame in selected] == [30.5, 90.5]
    assert all("selected-" in frame["path"] for frame in selected)
    assert [call[1] for call in calls] == [30.5, 90.5]
