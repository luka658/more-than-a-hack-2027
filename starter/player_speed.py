"""Player-speed summaries shared by the notebook and local viewer.

The viewer only uses standard-library helpers. pandas/numpy/matplotlib are imported
inside analysis functions, so the viewer keeps its dependency-free setup.
"""

import math
from pathlib import Path
import statistics
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from games import GAME, GAMES, asset_paths, half_video_blocks


def summarize_speeds(values):
    """Scalar speeds across visible player slots; missing is not stationary."""
    valid = [value for value in values
             if value is not None and math.isfinite(value) and value >= 0]
    count = len(valid)
    total = math.fsum(valid) if count else None
    return {"count": count, "mean": total / count if count else None,
            "median": statistics.median(valid) if count else None, "total": total,
            "min": min(valid) if count else None, "max": max(valid) if count else None}


def speed_metadata(meta_path):
    root = ET.parse(meta_path).getroot()
    channel = next((item for item in root.iter("Channel") if item.get("id") == "s"), None)
    source_unit = channel.findtext("Unit", "unknown").strip() if channel is not None else "unknown"
    unit = {"kph": "km/h", "km/h": "km/h", "m/s": "m/s", "mps": "m/s"}.get(source_unit.lower(), "source units")
    return {"unit": unit, "sourceUnit": source_unit,
            "slots": len(list(root.iter("Player"))),
            "ballHeightAvailable": any(item.get("channelId") == "z" for item in root.iter("BallChannelRef"))}


def iter_speed_rows(raw_path, expected_frames, expected_slots):
    """Read the delivered x,y,speed export without loading a full kloppy dataset."""
    count = 0
    with open(raw_path, encoding="ascii") as handle:
        for frame, line in enumerate(handle):
            frame_id, raw_players, _ = line.strip().split(":")
            if int(frame_id) != frame + 1 or frame >= expected_frames:
                raise ValueError("ATD frame IDs must match the zero-based video timeline + 1")
            groups = raw_players.split(";")
            if len(groups) != expected_slots:
                raise ValueError("ATD player slots do not match metadata")
            speeds, tracked = [], 0
            for group in groups:
                x, y, speed = map(float, group.split(","))
                if math.isfinite(x) and math.isfinite(y):
                    tracked += 1
                    speeds.append(speed)
            yield {"frame": frame, "tracked": tracked, **summarize_speeds(speeds)}
            count += 1
    if count != expected_frames:
        raise ValueError("ATD frame count does not match the video")


def speed_timeline(raw_path, frames, slots, fps=25):
    """One-second means of per-frame statistics, preserving empty bins as null."""
    bins, rows = [], []

    def flush():
        valid = [row for row in rows if row["count"]]
        bins.append({"start": rows[0]["frame"], "end": rows[-1]["frame"] + 1,
                     "validFrames": len(valid),
                     "count": sum(row["count"] for row in rows) / len(rows),
                     **{key: math.fsum(row[key] for row in valid) / len(valid) if valid else None
                        for key in ("mean", "median", "total", "min", "max")}})

    for row in iter_speed_rows(raw_path, frames, slots):
        rows.append(row)
        if len(rows) == fps:
            flush()
            rows = []
    if rows:
        flush()
    return bins


def load_speed_table(game=GAME, data_dir=None):
    """One row per video frame. Values keep the units declared by the source XML."""
    import pandas as pd
    paths = asset_paths(game=game, data_dir=data_dir)
    meta = speed_metadata(paths["atd_meta"])
    table = pd.DataFrame(iter_speed_rows(paths["atd_raw"], GAMES[game]["n_video_frames"], meta["slots"]))
    table["seconds"] = table["frame"] / GAMES[game]["fps"]
    table.attrs.update(meta)
    return table


def plot_speed_timelines(table, game=GAME, bin_seconds=1, start_minute=0, end_minute=None):
    """Two figures: mean/median/min/max speed, then total with valid-slot coverage."""
    import numpy as np
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    if not math.isfinite(bin_seconds) or bin_seconds <= 0:
        raise ValueError("bin_seconds must be positive")
    fps = GAMES[game]["fps"]
    width = max(1, round(bin_seconds * fps))
    binned = table.groupby(table["frame"] // width).agg(
        frame=("frame", "min"), mean=("mean", "mean"), median=("median", "mean"),
        total=("total", "mean"), count=("count", "mean"),
        min=("min", "mean"), max=("max", "mean"))
    binned["minute"] = binned["frame"] / fps / 60
    end_minute = end_minute if end_minute is not None else len(table) / fps / 60
    if not 0 <= start_minute < end_minute:
        raise ValueError("Choose a nonnegative start before the end minute")
    binned = binned[(binned.minute >= start_minute) & (binned.minute < end_minute)]
    if binned.empty:
        raise ValueError("No frames in the selected time window")
    unit = table.attrs.get("unit", "source units")
    blocks = half_video_blocks(game)
    excluded = [(0, blocks[0][1]), (blocks[0][2] + 1, blocks[1][1]), (blocks[1][2] + 1, len(table))]

    def setup(title, subtitle):
        fig, ax = plt.subplots(figsize=(14, 4.8))
        fig.subplots_adjust(left=.075, right=.92, top=.71, bottom=.19)
        fig.text(.075, .95, title, fontsize=20, weight="bold", color="#183044")
        fig.text(.075, .89, subtitle, fontsize=10, color="#526171")
        for first, last in excluded:
            ax.axvspan(first / fps / 60, last / fps / 60, color="#edf0f4", zorder=0)
        ax.set_xlim(start_minute, end_minute)
        ax.set_xlabel("Tactical video time (minutes)")
        ax.grid(axis="y", color="#e5e9ee")
        ax.spines[["top", "right"]].set_visible(False)
        ax.tick_params(length=0)
        top = ax.secondary_xaxis("top", functions=(lambda value: value * fps * 60, lambda value: value / fps / 60))
        top.set_xlabel("Video frame (zero-based)", fontsize=9)
        top.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:,.0f}"))
        fig.text(.075, .035, f"{width / fps:g}-second bins: average of per-frame statistics. Missing speeds excluded; no observations = gap. Gray = outside graded halves.", fontsize=9, color="#526171")
        return fig, ax

    fig1, ax1 = setup("Player speed: mean, median, highest and lowest", f"Both teams | visible ATD slots with finite, nonnegative speed | units: {unit} (source XML)")
    ax1.fill_between(binned.minute, binned["min"], binned["max"], color="#62a28b", alpha=.12)
    ax1.plot(binned.minute, binned["max"], label="Highest", color="#39866e", lw=.9)
    ax1.plot(binned.minute, binned["min"], label="Lowest", color="#a25c83", lw=.9)
    ax1.plot(binned.minute, binned["mean"], label="Mean", color="#2478a7", lw=1.3)
    ax1.plot(binned.minute, binned["median"], label="Median", color="#d57735", lw=1.1)
    ax1.set_ylabel(f"Player speed ({unit})")
    ax1.set_ylim(bottom=0)
    ax1.legend(loc="upper right", frameon=False, ncol=4)

    fig2, ax2 = setup("Total player speed and tracking coverage", "Sum of scalar speeds across both teams; this is not a velocity vector or distance. Coverage can change the total.")
    ax2.plot(binned.minute, binned.total, label="Total speed", color="#7a58b2", lw=1.3)
    ax2.set_ylabel(f"Sum of player speeds ({unit})")
    ax2.set_ylim(bottom=0)
    coverage = ax2.twinx()
    coverage.plot(binned.minute, binned["count"], label="Slots with valid speed", color="#87949b", alpha=.65, lw=.8)
    coverage.set_ylabel("Slots with valid speed", color="#677683")
    coverage.set_ylim(0, max(24, np.nanmax(binned["count"]) + 2))
    coverage.spines["top"].set_visible(False)
    lines = ax2.lines + coverage.lines
    ax2.legend(lines, [line.get_label() for line in lines], loc="upper right", frameon=False, ncol=2)
    return fig1, fig2
