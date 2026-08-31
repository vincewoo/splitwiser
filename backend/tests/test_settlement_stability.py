"""The simplified-debt plan must not rewrite itself as people pay it.

A group gets told "Ana pays Dev $12.00, Ben pays Eve $8.00" and then goes off
to pay. Recomputing the plan from the live balances re-sorts the debtors and
creditors, so recording Ana's payment used to hand Ben a different instruction
than the one he was given. These tests pin the fix: the plan's *order* is
anchored to the ledger with settlements left out, so paying one transaction
leaves every other one alone.
"""

from datetime import date
from unittest.mock import patch

import models
from auth import get_password_hash
from utils.balances import simplify

# Five people, arranged so that the greedy matching pairs several of them up.
# Anyone can verify the plan by hand: debtors -15.00 and -15.00, creditors
# +12.00, +11.00 and +7.00.
CHURN_CASE = {
    (1, False): -1500,
    (2, False): -1500,
    (3, False): 1200,
    (4, False): 1100,
    (5, False): 700,
}


def _edges(transactions):
    return [
        (t["from_id"], t["to_id"], round(t["amount"]))
        for t in transactions
    ]


def test_paid_transaction_leaves_the_rest_of_the_plan_alone():
    plan = simplify(CHURN_CASE, "USD", anchors=CHURN_CASE)
    assert _edges(plan) == [(1, 3, 1200), (1, 4, 300), (2, 4, 800), (2, 5, 700)]

    # Person 1 pays person 3 the 12.00 they were told to pay.
    paid = plan[0]
    after = dict(CHURN_CASE)
    after[(1, False)] += paid["amount"]
    after[(3, False)] -= paid["amount"]

    # Anchors are the pre-settlement ledger, so recording the payment does not
    # move them.
    replanned = simplify(after, "USD", anchors=CHURN_CASE)
    assert _edges(replanned) == _edges(plan)[1:]


def test_partial_payment_only_shrinks_its_own_transaction():
    after = dict(CHURN_CASE)
    after[(1, False)] += 500
    after[(3, False)] -= 500

    replanned = simplify(after, "USD", anchors=CHURN_CASE)
    assert _edges(replanned) == [(1, 3, 700), (1, 4, 300), (2, 4, 800), (2, 5, 700)]


def test_without_anchors_the_plan_still_churns():
    """Characterizing the old behaviour, so the anchor is not mistaken for a no-op."""
    plan = simplify(CHURN_CASE, "USD")
    after = dict(CHURN_CASE)
    after[(1, False)] += plan[0]["amount"]
    after[(3, False)] -= plan[0]["amount"]

    assert _edges(simplify(after, "USD")) != _edges(plan)[1:]


def test_plan_with_no_anchors_matches_largest_first_greedy():
    """Omitting anchors leaves the historical largest-first behaviour intact."""
    assert _edges(simplify(CHURN_CASE, "USD")) == _edges(
        simplify(CHURN_CASE, "USD", anchors=CHURN_CASE)
    )


def test_amounts_are_whole_cents():
    """Sub-cent balances would produce a plan no recorded payment can cancel."""
    plan = simplify(
        {(1, False): -1000.4, (2, False): 1000.4},
        "USD",
        anchors={(1, False): -1000.4, (2, False): 1000.4},
    )
    assert [t["amount"] for t in plan] == [1000.0]


def test_ties_are_broken_by_id_not_ledger_order():
    balances = {(2, False): 1000, (1, False): 1000, (3, False): -2000}
    reversed_insertion = {(1, False): 1000, (2, False): 1000, (3, False): -2000}
    assert _edges(simplify(balances, "USD")) == _edges(simplify(reversed_insertion, "USD"))


# ---------------------------------------------------------------------------
# End to end, through the endpoint the app actually calls.
# ---------------------------------------------------------------------------


def _member(db_session, email, name):
    user = models.User(
        email=email,
        hashed_password=get_password_hash("password123"),
        full_name=name,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _group_of_five(client, auth_headers, db_session, test_user, currency="USD"):
    """A group whose balances are -15, -15, +12, +11, +7 in ``currency``."""
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Ski trip", "default_currency": currency},
    ).json()["id"]

    others = []
    for n in range(2, 6):
        user = _member(db_session, f"p{n}@example.com", f"Person {n}")
        client.post(
            f"/groups/{group_id}/members", headers=auth_headers, json={"email": user.email}
        )
        others.append(user)

    a, b, c, d = others  # test_user and `a` owe; c, d and b are owed

    def expense(payer, amount, splits):
        assert client.post(
            "/expenses/",
            headers=auth_headers,
            json={
                "description": "Something",
                "amount": amount,
                "currency": currency,
                "date": str(date.today()),
                "payer_id": payer.id,
                "group_id": group_id,
                "split_type": "EXACT",
                "splits": [
                    {"user_id": u.id, "amount_owed": owed, "is_guest": False}
                    for u, owed in splits
                ],
            },
        ).status_code == 200

    expense(b, 3000, [(test_user, 1500), (a, 1500)])
    expense(c, 1100, [(b, 1100)])
    expense(d, 700, [(b, 700)])

    return group_id


def test_recording_a_suggested_payment_does_not_move_the_others(
    client, auth_headers, db_session, test_user
):
    group_id = _group_of_five(client, auth_headers, db_session, test_user)

    plan = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    assert len(plan) >= 3

    # Record the first one exactly as the Simplify Debts screen does.
    paid = plan[0]
    assert client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Payment",
            "amount": round(paid["amount"]),
            "currency": paid["currency"],
            "date": str(date.today()),
            "group_id": group_id,
            "payer_id": paid["from_id"],
            "payer_is_guest": paid["from_is_guest"],
            "split_type": "EQUAL",
            "is_settlement": True,
            "splits": [
                {
                    "user_id": paid["to_id"],
                    "is_guest": paid["to_is_guest"],
                    "amount_owed": round(paid["amount"]),
                }
            ],
        },
    ).status_code == 200

    after = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    assert _edges(after) == _edges(plan)[1:]


def test_settling_every_payment_clears_the_group(
    client, auth_headers, db_session, test_user
):
    group_id = _group_of_five(client, auth_headers, db_session, test_user)

    # Pay them one at a time, re-reading the plan after each — which is what a
    # group actually does — and check nothing new ever appears.
    remaining = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    expected = _edges(remaining)

    while remaining:
        paid = remaining[0]
        client.post(
            "/expenses/",
            headers=auth_headers,
            json={
                "description": "Payment",
                "amount": round(paid["amount"]),
                "currency": paid["currency"],
                "date": str(date.today()),
                "group_id": group_id,
                "payer_id": paid["from_id"],
                "payer_is_guest": paid["from_is_guest"],
                "split_type": "EQUAL",
                "is_settlement": True,
                "splits": [
                    {
                        "user_id": paid["to_id"],
                        "is_guest": paid["to_is_guest"],
                        "amount_owed": round(paid["amount"]),
                    }
                ],
            },
        )
        expected = expected[1:]
        remaining = client.get(
            f"/simplify_debts/{group_id}", headers=auth_headers
        ).json()["transactions"]
        assert _edges(remaining) == expected

    balances = client.get(f"/groups/{group_id}/balances", headers=auth_headers).json()
    assert all(abs(b["amount"]) < 1 for b in balances)


def test_a_settlement_in_the_group_currency_cancels_exactly(
    client, auth_headers, db_session, test_user
):
    """A EUR payment in a EUR group must not round-trip through USD.

    The two conversion legs use different rates — the one stored on the expense
    going out, the static table coming back — so a currency's own expenses used
    to arrive back slightly changed, and a settlement cleared a little more or
    less than the debt it was recorded against.
    """
    other = _member(db_session, "eur@example.com", "Euro Friend")

    with patch("utils.currency.fetch_historical_exchange_rate", return_value=1.5):
        group_id = client.post(
            "/groups/",
            headers=auth_headers,
            json={"name": "Berlin", "default_currency": "EUR"},
        ).json()["id"]
        client.post(
            f"/groups/{group_id}/members", headers=auth_headers, json={"email": other.email}
        )
        client.post(
            "/expenses/",
            headers=auth_headers,
            json={
                "description": "Dinner",
                "amount": 10000,
                "currency": "EUR",
                "date": "2023-01-01",
                "payer_id": test_user.id,
                "group_id": group_id,
                "split_type": "EXACT",
                "splits": [
                    {"user_id": test_user.id, "amount_owed": 0, "is_guest": False},
                    {"user_id": other.id, "amount_owed": 10000, "is_guest": False},
                ],
            },
        )

        plan = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
            "transactions"
        ]
        assert _edges(plan) == [(other.id, test_user.id, 10000)]

        # Paid back in full, at a different rate to the one on the expense.
        with patch("utils.currency.fetch_historical_exchange_rate", return_value=1.9):
            client.post(
                "/expenses/",
                headers=auth_headers,
                json={
                    "description": "Payment",
                    "amount": 10000,
                    "currency": "EUR",
                    "date": str(date.today()),
                    "group_id": group_id,
                    "payer_id": other.id,
                    "split_type": "EQUAL",
                    "is_settlement": True,
                    "splits": [
                        {"user_id": test_user.id, "amount_owed": 10000, "is_guest": False}
                    ],
                },
            )

        assert (
            client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
                "transactions"
            ]
            == []
        )


def test_off_plan_payment_still_reconciles(client, auth_headers, db_session, test_user):
    """Paying someone the plan never named is a real change — it may re-route,
    but the remaining payments must still add up to the remaining balances."""
    group_id = _group_of_five(client, auth_headers, db_session, test_user)

    plan = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    creditor = next(t["to_id"] for t in plan if t["from_id"] != test_user.id)

    client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Paid you directly",
            "amount": 500,
            "currency": "USD",
            "date": str(date.today()),
            "group_id": group_id,
            "payer_id": test_user.id,
            "split_type": "EQUAL",
            "is_settlement": True,
            "splits": [{"user_id": creditor, "amount_owed": 500, "is_guest": False}],
        },
    )

    after = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    balances = {
        (b["user_id"], b["is_guest"]): b["amount"]
        for b in client.get(f"/groups/{group_id}/balances", headers=auth_headers).json()
    }
    settled = {}
    for t in after:
        settled[(t["from_id"], t["from_is_guest"])] = (
            settled.get((t["from_id"], t["from_is_guest"]), 0) - t["amount"]
        )
        settled[(t["to_id"], t["to_is_guest"])] = (
            settled.get((t["to_id"], t["to_is_guest"]), 0) + t["amount"]
        )
    for key, amount in balances.items():
        assert abs(amount - settled.get(key, 0)) < 1
