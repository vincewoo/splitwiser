"""relax_assignment_user_id.py: rebuild the assignments table with user_id nullable."""

import sqlite3
from pathlib import Path

from migrations.relax_assignment_user_id import migrate

# The table as databases created before add_expense_guests.py still have it.
LEGACY_SCHEMA = [
    """
    CREATE TABLE expense_item_assignments (
        id INTEGER NOT NULL,
        expense_item_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        is_guest BOOLEAN, expense_guest_id INTEGER,
        PRIMARY KEY (id)
    )
    """,
    "CREATE INDEX ix_expense_item_assignments_id ON expense_item_assignments (id)",
    "CREATE INDEX ix_expense_item_assignments_expense_guest_id"
    " ON expense_item_assignments(expense_guest_id)",
]


def _legacy_db(tmp_path):
    path = tmp_path / "db.sqlite3"
    conn = sqlite3.connect(path)
    for statement in LEGACY_SCHEMA:
        conn.execute(statement)
    conn.executemany(
        "INSERT INTO expense_item_assignments"
        " (id, expense_item_id, user_id, is_guest, expense_guest_id)"
        " VALUES (?, ?, ?, ?, ?)",
        [(1, 10, 5, 0, None), (2, 10, 7, 1, None), (3, 11, 5, 0, None)],
    )
    conn.commit()
    conn.close()
    return str(path)


def _user_id_not_null(path):
    conn = sqlite3.connect(path)
    flags = {
        row[1]: row[3]
        for row in conn.execute("PRAGMA table_info(expense_item_assignments)")
    }
    conn.close()
    return flags["user_id"]


def _guest_insert(path):
    conn = sqlite3.connect(path)
    conn.execute(
        "INSERT INTO expense_item_assignments"
        " (expense_item_id, user_id, is_guest, expense_guest_id)"
        " VALUES (12, NULL, 0, 3)"
    )
    conn.commit()
    conn.close()


def test_legacy_table_refuses_a_guest_assignment(tmp_path):
    path = _legacy_db(tmp_path)
    try:
        _guest_insert(path)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("the legacy schema should refuse a NULL user_id")


def test_rebuild_relaxes_user_id_and_keeps_rows_and_indexes(tmp_path):
    path = _legacy_db(tmp_path)

    assert migrate(path) == 0

    assert _user_id_not_null(path) == 0
    conn = sqlite3.connect(path)
    rows = conn.execute(
        "SELECT id, expense_item_id, user_id, is_guest, expense_guest_id"
        " FROM expense_item_assignments ORDER BY id"
    ).fetchall()
    indexes = {
        name
        for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
            " AND tbl_name='expense_item_assignments'"
        )
    }
    leftover = conn.execute(
        "SELECT name FROM sqlite_master WHERE name='expense_item_assignments_new'"
    ).fetchone()
    conn.close()
    assert rows == [(1, 10, 5, 0, None), (2, 10, 7, 1, None), (3, 11, 5, 0, None)]
    assert indexes == {
        "ix_expense_item_assignments_id",
        "ix_expense_item_assignments_expense_guest_id",
    }
    assert leftover is None

    _guest_insert(path)


def test_rerun_does_nothing(tmp_path, capsys):
    path = _legacy_db(tmp_path)
    migrate(path)
    capsys.readouterr()

    assert migrate(path) == 0

    assert "already nullable" in capsys.readouterr().out


def test_dry_run_writes_nothing(tmp_path, capsys):
    path = _legacy_db(tmp_path)

    assert migrate(path, dry_run=True) == 0

    assert "keeping 3 rows" in capsys.readouterr().out
    assert _user_id_not_null(path) == 1


def test_missing_table_is_a_no_op(tmp_path):
    path = tmp_path / "db.sqlite3"
    sqlite3.connect(path).close()

    assert migrate(str(path)) == 0


def test_models_schema_already_nullable(db_session):
    """A database built from models.py needs no rebuild."""
    rows = db_session.connection().exec_driver_sql(
        "PRAGMA table_info(expense_item_assignments)"
    )
    assert {row[1]: row[3] for row in rows}["user_id"] == 0


def test_registered_before_the_backfill():
    """The backfill writes guest assignments, so the rebuild must run first."""
    lines = (Path(__file__).parents[2] / "start.sh").read_text().splitlines()
    relax = lines.index(
        'python migrations/relax_assignment_user_id.py --db-path "$DATABASE_PATH"'
    )
    backfill = lines.index(
        'python migrations/backfill_tab_expense_items.py --db-path "$DATABASE_PATH"'
    )
    assert relax < backfill
