"""Unit tests for the CSV rendering layer. No HTTP, no database."""

import csv
import io

from utils.balance_sheet import BalanceSheet, CheckRow, NetRow
from utils.csv_export import BOM, escape_cell, filename_for, money, render_csv


def _sheet(**overrides) -> BalanceSheet:
    defaults = dict(
        group_id=1,
        group_name="Tahoe Trip",
        currency="USD",
        generated_at="2026-08-30T12:00:00Z",
        generated_for="vince@example.com",
        rate_note="",
    )
    defaults.update(overrides)
    return BalanceSheet(**defaults)


class TestEscapeCell:
    """A spreadsheet formula in an expense description is an attack, not a typo."""

    def test_neutralizes_every_formula_prefix(self):
        for prefix in ("=", "+", "@", "\t", "\r"):
            value = f"{prefix}IMPORTXML(\"evil\")"
            assert escape_cell(value) == "'" + value

    def test_leaves_ordinary_text_alone(self):
        assert escape_cell("Dinner at Nopa") == "Dinner at Nopa"

    def test_hyphen_led_text_is_escaped(self):
        # "-A1" is a formula to a spreadsheet even though it reads as a dash.
        assert escape_cell("-Dinner") == "'-Dinner"

    def test_negative_numbers_are_not_escaped(self):
        # We write these ourselves; quoting them would break numeric columns.
        assert escape_cell(-500) == "-500"

    def test_negative_money_strings_are_not_escaped(self):
        # money() returns a string, so it meets the "-" formula prefix. Quoting
        # it would turn every negative balance into text.
        assert escape_cell(money(-7127)) == "-71.27"
        assert escape_cell("-71.27") == "-71.27"

    def test_a_number_followed_by_anything_else_is_still_escaped(self):
        assert escape_cell("-71.27+cmd") == "'-71.27+cmd"

    def test_booleans_render_lowercase(self):
        assert escape_cell(True) == "true"
        assert escape_cell(False) == "false"

    def test_none_is_empty(self):
        assert escape_cell(None) == ""


class TestMoney:
    def test_two_places_always(self):
        assert money(14200) == "142.00"
        assert money(5) == "0.05"
        assert money(0) == "0.00"

    def test_negative(self):
        assert money(-1) == "-0.01"
        assert money(-14200) == "-142.00"

    def test_jpy_keeps_two_places(self):
        # format_currency drops the decimals for JPY, which is right for the UI
        # and wrong for a column somebody sums.
        assert money(150000) == "1500.00"

    def test_none_is_empty(self):
        assert money(None) == ""


class TestRenderCsv:
    def test_starts_with_a_bom(self):
        assert render_csv(_sheet()).startswith(BOM)

    def test_sections_are_labelled_and_parseable(self):
        sheet = _sheet(
            net=[NetRow(
                key=(1, False), display_name="Vince", person_type="user",
                consumed_cents=7100, paid_cents=14200, net_cents=7100,
                currency="USD", note="",
            )],
            checks=[CheckRow(check="net_balances_sum_to_zero", passed=True, detail="")],
        )
        output = render_csv(sheet)

        assert "# SECTION: META" in output
        assert "# SECTION: NET_BALANCE" in output
        assert "# SECTION: CHECKS" in output

        rows = list(csv.reader(io.StringIO(output)))
        net_rows = [r for r in rows if r and r[0] == "NET_BALANCE"]
        assert len(net_rows) == 1
        assert "Vince" in net_rows[0]
        assert "71.00" in net_rows[0]

    def test_failed_check_renders_as_FAIL(self):
        sheet = _sheet(checks=[
            CheckRow(check="net_balances_sum_to_zero", passed=False, detail="residual 3 cents"),
        ])
        rows = [r for r in csv.reader(io.StringIO(render_csv(sheet))) if r and r[0] == "CHECKS"]
        assert rows[0][2] == "FAIL"
        assert rows[0][3] == "residual 3 cents"

    def test_conversion_section_omitted_for_a_single_currency_group(self):
        assert "# SECTION: CONVERSION" not in render_csv(_sheet())

    def test_rate_note_only_when_present(self):
        assert "rate_note" not in render_csv(_sheet())
        assert "rate_note" in render_csv(_sheet(rate_note="2 expenses had no stored rate"))


class TestFilename:
    def test_slugifies_the_group_name(self):
        assert filename_for(_sheet()) == "balance-sheet-tahoe-trip-2026-08-30.csv"

    def test_strips_characters_that_do_not_belong_in_a_header(self):
        name = filename_for(_sheet(group_name='Trip"; rm -rf /'))
        assert '"' not in name and ";" not in name and " " not in name
        assert name.startswith("balance-sheet-trip-rm-rf")

    def test_falls_back_when_the_name_slugifies_to_nothing(self):
        assert filename_for(_sheet(group_name="🎉🎉", group_id=42)).startswith(
            "balance-sheet-group-42"
        )
