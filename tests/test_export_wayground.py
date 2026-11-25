import unittest
from unittest.mock import patch

import export_wayground as export


class WaygroundExportTests(unittest.TestCase):
    def setUp(self):
        self.anime = {
            "1": "Anime uno",
            "2": "Anime dos",
            "3": "Anime tres",
            "4": "Anime cuatro",
            "5": "Anime cinco",
            "6": "Anime seis",
        }

    @patch("export_wayground.random.shuffle", lambda values: None)
    def test_titles_answer_indexes_and_clues(self):
        rows = [
            {"Respuesta": "1 2", "Distractores": "3", "Otros Distractores": "4, 5",
             "Tipo": "Música", "Fuente": "private music clue"},
            {"Respuesta": "6", "Distractores": "", "Otros Distractores": "",
             "Tipo": "Descripción", "Fuente": "private description"},
            {"Respuesta": "1", "Distractores": "2, 3", "Tipo": "Frames",
             "Fuente": "frame1 frame2 frame3"},
        ]
        result = export.convert_questions(rows, self.anime)
        self.assertEqual(result[0], [
            "Adivina los animes según la canción", "Checkbox",
            "Anime uno", "Anime dos", "Anime tres", "Anime cuatro", "Anime cinco",
            "1,2", "45", "", "",
        ])
        self.assertEqual(result[1][0:2], ["Adivina el anime según la descripción", "Multiple Choice"])
        self.assertEqual(result[2][0], "Adivina el anime según las imágenes")
        for row in result:
            self.assertEqual(len(row), len(export.HEADERS))
            self.assertEqual(row[-2:], ["", ""])
            self.assertNotIn("private", " ".join(row))

    def test_rejects_unknown_and_duplicate_required_ids(self):
        for answer, distractors in (("9", "2"), ("1", "1")):
            with self.subTest(answer=answer, distractors=distractors):
                with self.assertRaisesRegex(ValueError, "row 2"):
                    export.convert_questions(
                        [{"Respuesta": answer, "Distractores": distractors, "Tipo": "Musica"}],
                        self.anime,
                    )

    def test_reads_template_header_and_instructions(self):
        header, instructions = export.read_template(export.TEMPLATE)
        self.assertEqual(header, export.HEADERS)
        self.assertEqual(len(instructions), len(header))


if __name__ == "__main__":
    unittest.main()
