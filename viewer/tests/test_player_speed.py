import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_match_data import fixture
from starter.player_speed import summarize_speeds, iter_speed_rows, speed_timeline, speed_metadata


class SpeedTests(unittest.TestCase):
    def test_missing_is_not_zero_and_even_median_is_correct(self):
        self.assertEqual(summarize_speeds([0, 2, 4, 10, None, math.nan, math.inf, -1]),
                         {"mean": 4.0, "median": 3.0, "total": 16.0, "count": 4, "min": 0, "max": 10})
        self.assertEqual(summarize_speeds([None, math.nan]),
                         {"mean": None, "median": None, "total": None, "count": 0, "min": None, "max": None})
        self.assertEqual(summarize_speeds([0])["total"], 0)

    def test_source_units_and_missing_height_are_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            data = fixture(folder)
            data.paths["atd_meta"].write_text('<main><Player/><Channel id="s"><Name>speed_kph</Name><Unit>kph</Unit></Channel><BallChannelRef channelId="s"/></main>')
            meta = speed_metadata(data.paths["atd_meta"])
            self.assertEqual(meta["unit"], "km/h")
            self.assertFalse(meta["ballHeightAvailable"])

    def test_timeline_matches_exact_frame_stats_and_preserves_gaps(self):
        with tempfile.TemporaryDirectory() as folder:
            data = fixture(folder)
            raw = data.paths["atd_raw"]
            raw.write_text('1:0,0,0;1,1,4:NaN,NaN,NaN\n'
                           '2:0,0,2;1,1,6:NaN,NaN,NaN\n'
                           '3:NaN,NaN,100;1,1,NaN:NaN,NaN,NaN\n')
            rows = list(iter_speed_rows(raw, 3, 2))
            self.assertEqual(rows[0]["mean"], 2)
            self.assertEqual(rows[1]["total"], 8)
            self.assertEqual(rows[2]["tracked"], 1)
            self.assertEqual(rows[2]["count"], 0)
            bins = speed_timeline(raw, 3, 2, fps=2)
            self.assertEqual(bins[0]["mean"], 3)
            self.assertEqual(bins[0]["total"], 6)
            self.assertEqual((rows[1]["min"], rows[1]["max"]), (2, 6))
            self.assertEqual((bins[0]["min"], bins[0]["max"]), (1, 5))
            self.assertEqual((bins[1]["start"], bins[1]["end"]), (2, 3))
            self.assertIsNone(bins[1]["total"])
            self.assertIsNone(bins[1]["min"])
            self.assertIsNone(bins[1]["max"])

    def test_chunk_and_whole_timeline_agree(self):
        with tempfile.TemporaryDirectory() as folder:
            data = fixture(folder)
            row = data.chunk(0)["frames"][0]
            self.assertEqual(row["speed"], {"mean": 1.5, "median": 1.5, "total": 1.5, "count": 1, "min": 1.5, "max": 1.5})
            bins = data.speeds()["bins"]
            self.assertEqual(bins[0]["mean"], row["speed"]["mean"])
            self.assertEqual(bins[-1]["end"], 501)


if __name__ == '__main__':
    unittest.main()
