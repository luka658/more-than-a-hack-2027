import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from match_data import MatchData, parse_frame


def fixture(data_dir):
    data = MatchData(data_dir=data_dir, frames=501)
    data.paths["atd_raw"].parent.mkdir(parents=True, exist_ok=True)
    data.paths["atd_meta"].write_text(
        '<main><Team id="home"/><Team id="away"/>'
        '<Player teamId="home"/><Player teamId="away"/></main>', encoding="utf-8")
    with data.paths["atd_raw"].open("w", encoding="ascii", newline="") as handle:
        for frame in range(501):
            handle.write("{}:0.1,0.2,1.5;0.8,0.7,NaN:{}\r\n".format(
                frame + 1, "0.5,0.5,2.0" if frame % 2 else "NaN,NaN,NaN"))
    data.paths["smart_tagging"].write_text(
        '<file><instance><start>0.4</start><end>0.8</end><code>BUILD UP</code>'
        '<label><group>Team</group><text>Barcelona</text></label></instance></file>', encoding="utf-8")
    return data


class MatchDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = fixture(self.temp.name)

    def test_slots_coordinates_missing_ball_and_tail_chunk(self):
        self.assertEqual(self.data.metadata()["slots"], [{"id": 1, "team": "H"}, {"id": 2, "team": "A"}])
        last = self.data.chunk(500)
        self.assertEqual(len(last["frames"]), 1)
        self.assertEqual(last["frames"][0]["frame"], 500)
        first = self.data.chunk(0)["frames"]
        self.assertEqual(first[0]["players"], [[1, 0.1, 0.2, 1.5], [2, 0.8, 0.7, None]])
        self.assertIsNone(first[0]["ball"])
        self.assertEqual(first[1]["ball"], [0.5, 0.5, 2.0])
        json.dumps(first, allow_nan=False)

    def test_missing_players_and_off_pitch_positions_are_not_filled_or_clamped(self):
        row = parse_frame('1:NaN,NaN,NaN;1.01,-0.1,NaN:NaN,NaN,NaN', 0, self.data.metadata()["slots"])
        self.assertEqual(row["players"], [[2, 1.01, -0.1, None]])
        self.assertIsNone(row["ball"])

    def test_event_loader_uses_video_frame_intervals(self):
        event = self.data.events()[0]
        self.assertEqual((event["start_frame"], event["end_frame"]), (10, 20))
        self.assertEqual(event["tags"]["Team"], "Barcelona")

    def test_invalid_chunks_and_source_alignment_are_rejected(self):
        for start in [-500, 1, 501, 1000]:
            with self.assertRaises(ValueError):
                self.data.chunk(start)
        self.data.paths["atd_raw"].write_text('2:0,0,0;1,1,0:NaN,NaN,NaN\n')
        with self.assertRaisesRegex(ValueError, 'consecutive'):
            self.data.chunk(0)

    def test_truncated_tracking_is_rejected(self):
        self.data.paths["atd_raw"].write_text('1:0,0,0;1,1,0:NaN,NaN,NaN\n')
        with self.assertRaisesRegex(ValueError, 'frame count'):
            self.data.chunk(0)


if __name__ == '__main__':
    unittest.main()
