"""Rendering a :class:`~utils.balance_sheet.BalanceSheet` as CSV.

Presentation only — no money maths lives here.

Two decisions worth knowing about before editing:

* **Every cell is escaped against formula injection.** Expense descriptions,
  member names and group names are user-controlled and land in a file people
  open in Excel. A description of ``=IMPORTXML(...)`` is a live attack on
  whoever opens it, not a formatting quirk.
* **Money is written twice**: an integer cents column and a decimal column
  fixed at two places. ``format_currency`` is deliberately not used — it emits
  currency symbols and drops the decimals for JPY, which is right for the UI
  and useless to a spreadsheet. The currency code gets its own column instead.
"""

import csv
import io
import re
from typing import Iterable, Iterator, List, Optional

from utils.balance_sheet import BalanceSheet

# Excel and Sheets treat a leading one of these as the start of a formula.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

# A number we wrote ourselves. Negative amounts start with "-", which is a
# formula prefix, so without this every negative cell would be quoted and the
# net column — the one people actually sum — would stop being a number.
_NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")

# Prepended so Excel reads the file as UTF-8 rather than the local codepage,
# which otherwise mangles non-ASCII names and emoji group icons.
BOM = "﻿"


def escape_cell(value: object) -> str:
    """Render one value as a spreadsheet-safe string.

    A leading formula character is neutralised with a single quote, which
    spreadsheets strip on display. Plain numbers are exempt — including
    negative ones, whose leading "-" is a formula prefix — because a string of
    digits cannot be a formula and quoting it would break every numeric column
    in the file.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)

    text = str(value)
    if _NUMERIC.match(text):
        return text
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def money(cents: Optional[int]) -> str:
    """Cents as a fixed two-place decimal string, or empty for None."""
    if cents is None:
        return ""
    sign = "-" if cents < 0 else ""
    whole, remainder = divmod(abs(cents), 100)
    return f"{sign}{whole}.{remainder:02d}"


class _Writer:
    def __init__(self) -> None:
        self._buffer = io.StringIO()
        self._csv = csv.writer(self._buffer, lineterminator="\n")

    def row(self, values: Iterable[object]) -> None:
        self._csv.writerow([escape_cell(v) for v in values])

    def raw(self, text: str) -> None:
        self._buffer.write(text + "\n")

    def blank(self) -> None:
        self._buffer.write("\n")

    def section(self, name: str, header: List[str]) -> None:
        self.blank()
        self.raw(f"# SECTION: {name}")
        self.row(header)

    def drain(self) -> str:
        text = self._buffer.getvalue()
        self._buffer.seek(0)
        self._buffer.truncate(0)
        return text


def render_csv(sheet: BalanceSheet) -> str:
    """Render the whole sheet as one CSV string."""
    return "".join(iter_csv(sheet))


def iter_csv(sheet: BalanceSheet) -> Iterator[str]:
    """Yield the CSV a section at a time, so large groups stream."""
    w = _Writer()

    w.raw(BOM + "# SECTION: META")
    w.row(["section", "key", "value"])
    meta = [
        ("generated_at", sheet.generated_at),
        ("group_id", sheet.group_id),
        ("group_name", sheet.group_name),
        ("display_currency", sheet.currency),
        ("generated_for", sheet.generated_for),
        ("schema_version", "1"),
    ]
    if sheet.rate_note:
        meta.append(("rate_note", sheet.rate_note))
    for key, value in meta:
        w.row(["META", key, value])
    yield w.drain()

    w.section("PEOPLE", [
        "section", "person", "person_id", "person_type", "status",
        "managed_by", "note",
    ])
    for person in sheet.people:
        w.row([
            "PEOPLE", person.display_name, person.key[0], person.person_type,
            person.status, person.managed_by, person.note,
        ])
    yield w.drain()

    w.section("EXPENSES", [
        "section", "expense_id", "expense_description", "date", "payer",
        "payer_type", "item_id", "item_description", "is_tax_tip", "person",
        "person_id", "person_type", "split_type", "currency", "amount_cents",
        "amount", "exchange_rate", "converted_cents", "converted_amount", "note",
    ])
    for row in sheet.ledger:
        w.row([
            row.row_type, row.expense_id, row.expense_description, row.date,
            row.payer_name, row.payer_type, row.item_id, row.item_description,
            "" if row.is_tax_tip is None else row.is_tax_tip,
            row.person_name, row.person_id, row.person_type, row.split_type,
            row.currency, row.amount_cents, money(row.amount_cents),
            row.exchange_rate, row.converted_cents, money(row.converted_cents),
            row.note,
        ])
        # The ledger is the only unbounded section; flush it as it goes rather
        # than holding every row of a long-running group in memory.
        if row.row_type == "SPLIT":
            yield w.drain()
    yield w.drain()

    w.section("CONSUMPTION", [
        "section", "person", "person_id", "person_type", "currency",
        "amount_cents", "amount", "converted_cents", "converted_amount", "note",
    ])
    for row in sheet.consumption:
        w.row([
            "CONSUMPTION", row.display_name, row.key[0], row.person_type,
            row.currency, row.amount_cents, money(row.amount_cents),
            row.converted_cents, money(row.converted_cents), row.note,
        ])
    yield w.drain()

    w.section("PAID", [
        "section", "person", "person_id", "person_type", "currency",
        "amount_cents", "amount", "converted_cents", "converted_amount", "note",
    ])
    for row in sheet.paid:
        w.row([
            "PAID", row.display_name, row.key[0], row.person_type,
            row.currency, row.amount_cents, money(row.amount_cents),
            row.converted_cents, money(row.converted_cents), row.note,
        ])
    yield w.drain()

    if len(sheet.conversion) > 1 or (
        sheet.conversion and sheet.conversion[0].currency != sheet.currency
    ):
        w.section("CONVERSION", [
            "section", "currency", "target_currency", "expense_count",
            "historical_rates", "expenses_missing_a_stored_rate", "note",
        ])
        for row in sheet.conversion:
            w.row([
                "CONVERSION", row.currency, row.target_currency,
                row.expense_count, row.historical_rates, row.synthesized_count,
                row.note,
            ])
        yield w.drain()

    if sheet.management:
        w.section("MANAGEMENT", [
            "section", "person", "person_id", "person_type", "folded_into",
            "manager_id", "manager_type", "currency", "amount_cents", "amount",
            "reason", "folded", "note",
        ])
        for row in sheet.management:
            w.row([
                "MANAGEMENT", row.source_name, row.source_id, row.source_type,
                row.manager_name, row.manager_id, row.manager_type,
                row.currency, row.amount_cents, money(row.amount_cents),
                row.reason, row.folded, row.note,
            ])
        yield w.drain()

    if sheet.identity:
        w.section("IDENTITY", [
            "section", "guest_name", "guest_id", "claimed_by", "claimed_by_id",
            "ledger_rows_still_under_the_guest", "note",
        ])
        for row in sheet.identity:
            w.row([
                "IDENTITY", row.guest_name, row.guest_id, row.claimed_by_name,
                row.claimed_by_id, row.rows_still_under_guest, row.note,
            ])
        yield w.drain()

    w.section("NET_BALANCE", [
        "section", "person", "person_id", "person_type", "currency",
        "consumed_cents", "consumed", "paid_cents", "paid", "net_cents", "net",
        "note",
    ])
    for row in sheet.net:
        w.row([
            "NET_BALANCE", row.display_name, row.key[0], row.person_type,
            row.currency, row.consumed_cents, money(row.consumed_cents),
            row.paid_cents, money(row.paid_cents), row.net_cents,
            money(row.net_cents), row.note,
        ])
    yield w.drain()

    w.section("SIMPLIFIED", [
        "section", "from", "from_id", "from_type", "to", "to_id", "to_type",
        "currency", "amount_cents", "amount",
    ])
    for row in sheet.simplified:
        w.row([
            "SIMPLIFIED", row.from_name, row.from_id, row.from_type,
            row.to_name, row.to_id, row.to_type, row.currency,
            row.amount_cents, money(row.amount_cents),
        ])
    yield w.drain()

    w.section("CHECKS", ["section", "check", "result", "detail"])
    for row in sheet.checks:
        w.row(["CHECKS", row.check, "pass" if row.passed else "FAIL", row.detail])
    yield w.drain()


def filename_for(sheet: BalanceSheet) -> str:
    """A safe download filename. The group name is user-controlled."""
    slug = "".join(
        char if char.isalnum() else "-" for char in sheet.group_name.lower()
    )
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-")[:40] or f"group-{sheet.group_id}"
    return f"balance-sheet-{slug}-{sheet.generated_at[:10]}.csv"
