"""Tabs: the owner surface, the public claim surface, and close-out."""

from datetime import datetime, timedelta

import pytest

import models


def register(client, email, name):
    client.post(
        "/register",
        json={"email": email, "password": "password123", "full_name": name},
    )
    token = client.post(
        "/token", data={"username": email, "password": "password123"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def set_venmo(client, headers, handle):
    return client.put(
        "/users/me/profile", json={"venmo_username": handle}, headers=headers
    )


def make_tab(client, headers, **over):
    payload = {
        "name": "Bar Sol",
        "currency": "USD",
        "items": [
            {"description": "Pizza margherita", "price": 2800},
            {"description": "Vinho Verde", "price": 3400},
            {"description": "Polvo grelhado", "price": 3100},
        ],
        "tax": 900,
        "tip": 1000,
        "total": 11200,
    }
    payload.update(over)
    response = client.post("/tabs", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


class TestTabCreation:
    def test_creating_a_tab_issues_a_link_and_seats_the_opener(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        assert tab["status"] == "open"
        assert len(tab["items"]) == 3
        # The opener is already at the table.
        assert len(tab["participants"]) == 1
        assert tab["participants"][0]["display_name"] == "Vince Woo"
        # A usable, expiring link.
        assert tab["share_token"]
        assert len(tab["share_token"]) >= 32
        assert tab["token_expires_at"] is not None

    def test_tokens_are_unpredictable_and_unique(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tokens = {make_tab(client, headers)["share_token"] for _ in range(5)}
        assert len(tokens) == 5

    def test_a_tab_is_never_a_group(self, client, db_session):
        headers = register(client, "vince@example.com", "Vince Woo")
        make_tab(client, headers)
        assert db_session.query(models.Group).count() == 0
        assert client.get("/groups", headers=headers).json() == []

    def test_requires_authentication(self, client):
        assert client.post("/tabs", json={"name": "x"}).status_code == 401


class TestOwnerAccess:
    def test_another_user_cannot_read_someone_elses_tab(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.get(f"/tabs/{tab['id']}", headers=stranger)
        # Indistinguishable from a tab that does not exist.
        assert response.status_code == 404

    def test_the_owner_gets_the_scanned_receipt_back(self, client):
        """The board shows the photograph next to the lines parsed from it."""
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(
            client, owner, receipt_image_path="/static/receipts/bar-sol.jpg"
        )

        assert tab["receipt_image_path"] == "/static/receipts/bar-sol.jpg"
        fetched = client.get(f"/tabs/{tab['id']}", headers=owner).json()
        assert fetched["receipt_image_path"] == "/static/receipts/bar-sol.jpg"

    def test_listing_only_returns_your_own_tabs(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        assert client.get("/tabs", headers=stranger).json() == []
        assert len(client.get("/tabs", headers=owner).json()) == 1


class TestPublicRead:
    def test_the_link_opens_the_tab_without_an_account(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        public = client.get(f"/public/tabs/{tab['share_token']}")
        assert public.status_code == 200
        body = public.json()
        assert body["name"] == "Bar Sol"
        assert len(body["items"]) == 3

    def test_the_public_payload_leaks_nothing_extra(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        body = client.get(f"/public/tabs/{tab['share_token']}").json()
        # No way to re-derive the link, the owner, or anyone's claim token.
        assert "share_token" not in body
        assert "created_by_id" not in body
        assert "id" not in body
        for participant in body["participants"]:
            assert "claim_token" not in participant

    def test_the_receipt_photo_stays_with_the_owner(self, client):
        """A link-holder gets the parsed lines, not the photographed bill."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(
            client, headers, receipt_image_path="/static/receipts/bar-sol.jpg"
        )

        body = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert "receipt_image_path" not in body

    def test_an_unknown_token_is_rejected(self, client):
        assert client.get("/public/tabs/not-a-real-token").status_code == 404

    def test_an_expired_link_stops_working(self, client, db_session):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        row = db_session.query(models.Tab).filter(models.Tab.id == tab["id"]).first()
        row.token_expires_at = datetime.utcnow() - timedelta(seconds=1)
        db_session.commit()

        assert client.get(f"/public/tabs/{tab['share_token']}").status_code == 410

    def test_a_revoked_link_stops_working(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        client.post(f"/tabs/{tab['id']}/revoke", headers=headers)
        assert client.get(f"/public/tabs/{tab['share_token']}").status_code == 404


class TestJoiningAndClaiming:
    def test_joining_with_a_first_name_creates_a_participant(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": "Maya"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["participant"]["display_name"] == "Maya"
        # No account, so the claim token is the only handle they get.
        assert body["claim_token"]
        assert body["participant"]["user_id"] is None

    def test_claiming_and_releasing_a_line(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token = tab["share_token"]
        item_id = tab["items"][0]["id"]

        joined = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        claim_token = joined["claim_token"]
        maya_id = joined["participant"]["id"]

        claimed = client.post(
            f"/public/tabs/{token}/items/{item_id}/claim",
            json={"claim_token": claim_token, "claimed": True},
        ).json()
        item = next(i for i in claimed["items"] if i["id"] == item_id)
        assert item["claimed_by"] == [maya_id]

        released = client.post(
            f"/public/tabs/{token}/items/{item_id}/claim",
            json={"claim_token": claim_token, "claimed": False},
        ).json()
        item = next(i for i in released["items"] if i["id"] == item_id)
        assert item["claimed_by"] == []

    def test_claiming_twice_is_idempotent(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        joined = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()

        for _ in range(3):
            body = client.post(
                f"/public/tabs/{token}/items/{item_id}/claim",
                json={"claim_token": joined["claim_token"], "claimed": True},
            ).json()

        item = next(i for i in body["items"] if i["id"] == item_id)
        assert item["claimed_by"] == [joined["participant"]["id"]]

    def test_two_people_on_one_line_is_sharing_not_a_conflict(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        maya = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        ben = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Ben"}
        ).json()

        for person in (maya, ben):
            response = client.post(
                f"/public/tabs/{token}/items/{item_id}/claim",
                json={"claim_token": person["claim_token"], "claimed": True},
            )
            assert response.status_code == 200

        item = next(i for i in response.json()["items"] if i["id"] == item_id)
        assert sorted(item["claimed_by"]) == sorted(
            [maya["participant"]["id"], ben["participant"]["id"]]
        )

    def test_claiming_without_joining_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/public/tabs/{tab['share_token']}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": "made-up", "claimed": True},
        )
        assert response.status_code == 403

    def test_a_claim_token_from_another_tab_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        first = make_tab(client, headers)
        second = make_tab(client, headers, name="Other Bar")

        joined = client.post(
            f"/public/tabs/{first['share_token']}/join",
            json={"display_name": "Maya"},
        ).json()

        # The token belongs to `first`; it must not work against `second`.
        response = client.post(
            f"/public/tabs/{second['share_token']}/items/{second['items'][0]['id']}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        assert response.status_code == 403


class TestParticipantIdentity:
    """
    One person is one row. The claim token is who somebody is; the name is a
    label on that row, and changing it must not seat a second them.
    """

    def join(self, client, tab, name):
        response = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": name}
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_renaming_keeps_the_same_person_and_their_claims(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        joined = self.join(client, tab, "Maya")
        client.post(
            f"/public/tabs/{token}/items/{item_id}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )

        response = client.post(
            f"/public/tabs/{token}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "Maya B"},
        )
        assert response.status_code == 200, response.text
        body = response.json()

        # Same row, new label — and the item they ticked is still theirs.
        assert body["participant"]["id"] == joined["participant"]["id"]
        assert body["participant"]["display_name"] == "Maya B"
        assert [p["display_name"] for p in body["tab"]["participants"]] == [
            "Vince Woo",
            "Maya B",
        ]
        claimed = next(i for i in body["tab"]["items"] if i["id"] == item_id)
        assert claimed["claimed_by"] == [joined["participant"]["id"]]

    def test_renaming_does_not_hand_out_a_new_claim_token(self, client):
        """The old token is the claimer's only way back, so it keeps working."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token = tab["share_token"]

        joined = self.join(client, tab, "Maya")
        renamed = client.post(
            f"/public/tabs/{token}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "Maya B"},
        ).json()
        assert "claim_token" not in renamed

        still_works = client.post(
            f"/public/tabs/{token}/items/{tab['items'][1]['id']}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        assert still_works.status_code == 200

    def test_rejoining_under_the_same_name_is_refused(self, client):
        """
        The bug this guards: the claim page re-submitted the join form to
        change a name, so an unchanged name seated a duplicate person and the
        first one's claims were stranded.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        self.join(client, tab, "Maya")

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
        )
        assert response.status_code == 409
        assert "already claiming" in response.json()["detail"]

    def test_a_name_is_taken_regardless_of_case_or_padding(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        self.join(client, tab, "Maya")

        for variant in ("maya", "  MAYA  ", "MaYa"):
            response = client.post(
                f"/public/tabs/{tab['share_token']}/join",
                json={"display_name": variant},
            )
            assert response.status_code == 409, variant

    def test_the_hosts_name_is_taken_too(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "vince woo"},
        )
        assert response.status_code == 409

    def test_names_are_stored_tidied_up(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        joined = self.join(client, tab, "  Maya   B  ")
        assert joined["participant"]["display_name"] == "Maya B"

    def test_a_different_name_still_seats_a_second_person(self, client):
        """Uniqueness must not stop the rest of the table from joining."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        first = self.join(client, tab, "Maya")
        second = self.join(client, tab, "Maya B")
        assert first["participant"]["id"] != second["participant"]["id"]
        assert len(second["tab"]["participants"]) == 3

    def test_renaming_onto_someone_elses_name_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        self.join(client, tab, "Maya")
        joined = self.join(client, tab, "Sam")

        response = client.post(
            f"/public/tabs/{tab['share_token']}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "MAYA"},
        )
        assert response.status_code == 409

    def test_renaming_to_your_own_name_is_a_no_op(self, client):
        """Re-submitting the form unchanged must not read as a collision."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        joined = self.join(client, tab, "Maya")

        response = client.post(
            f"/public/tabs/{tab['share_token']}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "Maya"},
        )
        assert response.status_code == 200
        assert len(response.json()["tab"]["participants"]) == 2

    def test_renaming_needs_a_claim_token_for_this_tab(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        first = make_tab(client, headers)
        second = make_tab(client, headers, name="Other Bar")
        joined = self.join(client, first, "Maya")

        unknown = client.post(
            f"/public/tabs/{first['share_token']}/rename",
            json={"claim_token": "made-up", "display_name": "Maya B"},
        )
        assert unknown.status_code == 403

        # A token from another tab must not rename anyone here either.
        wrong_tab = client.post(
            f"/public/tabs/{second['share_token']}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "Maya B"},
        )
        assert wrong_tab.status_code == 403

    def test_a_closed_tab_refuses_renames(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        joined = self.join(client, tab, "Maya")
        client.post(
            f"/public/tabs/{tab['share_token']}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        assert client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers).status_code == 200

        response = client.post(
            f"/public/tabs/{tab['share_token']}/rename",
            json={"claim_token": joined["claim_token"], "display_name": "Maya B"},
        )
        assert response.status_code == 409

    def test_the_schema_refuses_a_duplicate_name(self, client, db_session):
        """
        The router checks first, but the index is the backstop for two phones
        typing the same name at the same moment.
        """
        from sqlalchemy.exc import IntegrityError

        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        self.join(client, tab, "Maya")

        db_session.add(
            models.TabParticipant(
                tab_id=tab["id"],
                display_name="maya",
                user_id=None,
                claim_token="a-different-token",
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_the_same_name_on_another_tab_is_fine(self, client, db_session):
        """Uniqueness is per tab: every table gets its own Maya."""
        headers = register(client, "vince@example.com", "Vince Woo")
        first = make_tab(client, headers)
        second = make_tab(client, headers, name="Other Bar")

        self.join(client, first, "Maya")
        joined = self.join(client, second, "Maya")
        assert joined["participant"]["display_name"] == "Maya"


class TestSignedInClaimers:
    """
    An account on the seat is what turns a claimer's share into an
    ExpenseSplit at close — so it reaches their balances — instead of an
    ExpenseGuest the payer has to chase in person.
    """

    def test_joining_signed_in_seats_the_account_and_its_name(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = register(client, "maya@example.com", "Maya Lin")

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["participant"]["display_name"] == "Maya Lin"
        assert body["participant"]["user_id"] is not None
        # Still handed a claim token: the public claim route is all this page has.
        assert body["claim_token"]

    def test_a_typed_name_still_wins_over_the_account_name(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = register(client, "maya@example.com", "Maya Lin")

        body = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
            headers=maya,
        ).json()
        assert body["participant"]["display_name"] == "Maya"
        assert body["participant"]["user_id"] is not None

    def test_the_host_opening_their_own_link_is_not_seated_twice(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        body = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=headers
        ).json()
        assert body["participant"]["id"] == tab["participants"][0]["id"]
        assert len(body["tab"]["participants"]) == 1
        # And they get the token they need to claim from this page.
        assert body["claim_token"]

    def test_rejoining_on_another_device_returns_the_same_seat(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = register(client, "maya@example.com", "Maya Lin")
        token = tab["share_token"]

        first = client.post(f"/public/tabs/{token}/join", json={}, headers=maya).json()
        client.post(
            f"/public/tabs/{token}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": first["claim_token"], "claimed": True},
        )

        # A second phone has no localStorage, so it joins again. The account,
        # not the browser, says who they are.
        second = client.post(f"/public/tabs/{token}/join", json={}, headers=maya).json()
        assert second["participant"]["id"] == first["participant"]["id"]
        assert len(second["tab"]["participants"]) == 2
        claimed = next(
            i for i in second["tab"]["items"] if i["id"] == tab["items"][0]["id"]
        )
        assert claimed["claimed_by"] == [first["participant"]["id"]]

    def test_signing_in_mid_tab_keeps_the_claims_made_as_a_guest(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        guest = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        client.post(
            f"/public/tabs/{token}/items/{item_id}/claim",
            json={"claim_token": guest["claim_token"], "claimed": True},
        )

        maya = register(client, "maya@example.com", "Maya Lin")
        adopted = client.post(
            f"/public/tabs/{token}/join",
            json={"claim_token": guest["claim_token"]},
            headers=maya,
        ).json()

        # Same seat, now theirs — with the line they ticked as a guest.
        assert adopted["participant"]["id"] == guest["participant"]["id"]
        assert adopted["participant"]["user_id"] is not None
        assert adopted["participant"]["display_name"] == "Maya"
        assert len(adopted["tab"]["participants"]) == 2
        claimed = next(i for i in adopted["tab"]["items"] if i["id"] == item_id)
        assert claimed["claimed_by"] == [guest["participant"]["id"]]

    def test_a_seat_that_belongs_to_another_account_is_not_adopted(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token = tab["share_token"]

        maya = register(client, "maya@example.com", "Maya Lin")
        hers = client.post(f"/public/tabs/{token}/join", json={}, headers=maya).json()

        # Sam somehow holds Maya's claim token; it must not make him Maya.
        sam = register(client, "sam@example.com", "Sam Reed")
        response = client.post(
            f"/public/tabs/{token}/join",
            json={"claim_token": hers["claim_token"]},
            headers=sam,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["participant"]["id"] != hers["participant"]["id"]
        assert body["participant"]["display_name"] == "Sam Reed"

    def test_an_expired_token_is_told_rather_than_seated_as_a_guest(self, client):
        """
        Quietly downgrading them would put their share on a guest row and lose
        the association they came for; a 401 lets the client refresh and retry.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert response.status_code == 401

    def test_an_account_name_already_at_the_table_is_refused(self, client):
        """The claim page falls back to asking for a name."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": "Maya Lin"}
        )

        maya = register(client, "maya@example.com", "Maya Lin")
        response = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        )
        assert response.status_code == 409

    def test_an_anonymous_join_still_needs_a_name(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(f"/public/tabs/{tab['share_token']}/join", json={})
        assert response.status_code == 400

    def test_the_schema_refuses_a_second_seat_for_one_account(self, client, db_session):
        from sqlalchemy.exc import IntegrityError

        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        owner_id = tab["created_by_id"]

        db_session.add(
            models.TabParticipant(
                tab_id=tab["id"],
                display_name="Vince again",
                user_id=owner_id,
                claim_token="another-token",
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_a_signed_in_claimers_share_lands_in_their_balances(self, client):
        """
        The point of the whole exercise: the closed tab is a real shared
        expense between two accounts, not a guest line only the payer sees.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(
            client,
            headers,
            items=[{"description": "Pizza margherita", "price": 2000}],
            tax=0,
            tip=0,
            total=2000,
        )
        token = tab["share_token"]

        maya = register(client, "maya@example.com", "Maya Lin")
        joined = client.post(f"/public/tabs/{token}/join", json={}, headers=maya).json()
        client.post(
            f"/public/tabs/{token}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )

        closed = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert closed.status_code == 200, closed.text

        # Maya owes Vince the whole line, and both of them can see it. Negative
        # is "you owe"; the amounts are cents, as everywhere else.
        hers = client.get("/balances", headers=maya).json()
        owed = [b for b in hers["balances"] if b["full_name"] == "Vince Woo"]
        assert owed and owed[0]["amount"] == pytest.approx(-2000.0)

        his = client.get("/balances", headers=headers).json()
        owed_to_him = [b for b in his["balances"] if b["full_name"] == "Maya Lin"]
        assert owed_to_him and owed_to_him[0]["amount"] == pytest.approx(2000.0)


class TestManualItems:
    def test_the_owner_can_add_a_line_to_a_live_tab(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/tabs/{tab['id']}/items",
            json={"description": "Another round", "price": 1800},
            headers=headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) == 4
        added = next(i for i in items if i["description"] == "Another round")
        assert added["added_manually"] is True

    def test_a_stranger_cannot_add_a_line(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.post(
            f"/tabs/{tab['id']}/items",
            json={"description": "Free stuff", "price": 1},
            headers=stranger,
        )
        assert response.status_code == 404

    def test_deleting_a_line_drops_its_claims(self, client, db_session):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        joined = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        client.post(
            f"/public/tabs/{token}/items/{item_id}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        assert db_session.query(models.TabItemClaim).count() == 1

        response = client.delete(
            f"/tabs/{tab['id']}/items/{item_id}", headers=headers
        )
        assert response.status_code == 200
        # A stale claim would otherwise be counted at close.
        assert db_session.query(models.TabItemClaim).count() == 0


class TestCorrectingTaxAndTip:
    """
    The scan is a convenience, not the authority. Whoever is holding the bill
    can correct what it read for as long as the tab is open.
    """

    def test_the_owner_can_correct_both(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.patch(
            f"/tabs/{tab['id']}/amounts",
            json={"tax": 750, "tip": 1700},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["tax"] == 750
        assert response.json()["tip"] == 1700

    def test_an_omitted_field_is_left_alone(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        body = client.patch(
            f"/tabs/{tab['id']}/amounts", json={"tip": 2000}, headers=headers
        ).json()
        assert body["tip"] == 2000
        assert body["tax"] == 900

    def test_the_total_follows_the_correction(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        # Items come to 9300; the receipt printed 11200.
        body = client.patch(
            f"/tabs/{tab['id']}/amounts",
            json={"tax": 0, "tip": 0},
            headers=headers,
        ).json()
        assert body["total"] == 9300

    def test_a_line_added_by_hand_is_counted_in_the_new_total(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/tabs/{tab['id']}/items",
            json={"description": "Another round", "price": 1800},
            headers=headers,
        )

        body = client.patch(
            f"/tabs/{tab['id']}/amounts",
            json={"tax": 100, "tip": 200},
            headers=headers,
        ).json()
        assert body["total"] == 9300 + 1800 + 100 + 200

    def test_the_correction_reaches_what_claimers_see(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        client.patch(
            f"/tabs/{tab['id']}/amounts", json={"tip": 2500}, headers=headers
        )
        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert public["tip"] == 2500

    def test_a_stranger_cannot_correct_them(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.patch(
            f"/tabs/{tab['id']}/amounts", json={"tip": 0}, headers=stranger
        )
        # Indistinguishable from a tab that does not exist.
        assert response.status_code == 404

    def test_a_link_holder_cannot_correct_them(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        assert (
            client.patch(f"/tabs/{tab['id']}/amounts", json={"tip": 0}).status_code
            == 401
        )

    def test_a_closed_tab_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.patch(
            f"/tabs/{tab['id']}/amounts", json={"tip": 1}, headers=headers
        )
        # The expense is already written; the two must not drift apart.
        assert response.status_code == 409

    def test_a_negative_amount_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.patch(
            f"/tabs/{tab['id']}/amounts", json={"tax": -1}, headers=headers
        )
        assert response.status_code == 422


class TestOwnerSeatsSomebody:
    """
    Seating a person from the owner's device — the table where somebody has no
    phone on them, and the only other way in is the link.
    """

    def test_the_owner_can_seat_a_guest(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dani"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        seated = next(
            p for p in response.json()["participants"] if p["display_name"] == "Dani"
        )
        # A guest seat: an account here would be the owner's, who already has one.
        assert seated["user_id"] is None

    def test_a_seated_guest_can_be_claimed_for_and_closes_into_the_expense(
        self, client, db_session
    ):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        seated = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dani"},
            headers=headers,
        ).json()
        dani = next(
            p for p in seated["participants"] if p["display_name"] == "Dani"
        )

        item_id = tab["items"][0]["id"]
        response = client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim/{dani['id']}",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 200
        claimed = next(i for i in response.json()["items"] if i["id"] == item_id)
        assert dani["id"] in claimed["claimed_by"]

        closed = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert closed.status_code == 200
        # No account, so they land as a guest line on the expense.
        guests = (
            db_session.query(models.ExpenseGuest)
            .filter(models.ExpenseGuest.expense_id == closed.json()["expense_id"])
            .all()
        )
        assert [g.name for g in guests] == ["Dani"]

    def test_the_name_rules_are_the_link_s_rules(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": "Maya"}
        )

        # Two Mayas are unusable however they arose.
        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "  maya "},
            headers=headers,
        )
        assert response.status_code == 409

    def test_a_seat_taken_here_blocks_the_same_name_on_the_link(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dani"},
            headers=headers,
        )

        response = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": "Dani"}
        )
        assert response.status_code == 409

    def test_a_blank_name_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "   "},
            headers=headers,
        )
        assert response.status_code == 400

    def test_a_stranger_cannot_seat_anyone(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Mallory"},
            headers=stranger,
        )
        # Same shape as not-found: a stranger learns nothing about this tab.
        assert response.status_code == 404

    def test_a_closed_tab_cannot_be_joined_by_the_owner_either(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/public/tabs/{tab['share_token']}/join", json={"display_name": "Maya"}
        )
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dani"},
            headers=headers,
        )
        assert response.status_code == 409

    def test_the_claim_token_is_never_handed_out(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dani"},
            headers=headers,
        )
        assert "claim_token" not in response.text


class TestClosing:
    def test_closing_produces_one_direct_expense_that_balances(self, client, db_session):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token = tab["share_token"]

        maya = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        # Maya takes the first line; the rest are unclaimed.
        client.post(
            f"/public/tabs/{token}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": maya["claim_token"], "claimed": True},
        )

        response = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert response.status_code == 200
        closed = response.json()
        assert closed["status"] == "closed"
        assert closed["expense_id"] is not None

        expense = (
            db_session.query(models.Expense)
            .filter(models.Expense.id == closed["expense_id"])
            .first()
        )
        # The whole point: a tab lands as a direct expense, not a group.
        assert expense.group_id is None
        assert expense.amount == 2800 + 3400 + 3100 + 900 + 1000

        splits = (
            db_session.query(models.ExpenseSplit)
            .filter(models.ExpenseSplit.expense_id == expense.id)
            .all()
        )
        guests = (
            db_session.query(models.ExpenseGuest)
            .filter(models.ExpenseGuest.expense_id == expense.id)
            .all()
        )
        # Vince has an account; Maya does not.
        assert len(splits) == 1
        assert len(guests) == 1
        assert guests[0].name == "Maya"
        # Every cent is accounted for.
        assert sum(s.amount_owed for s in splits) + sum(
            g.amount_owed for g in guests
        ) == expense.amount

    def test_the_link_still_reads_after_closing(self, client):
        """
        Guests are still holding the link open when the host closes. They
        should see the closed tab and their number, not a broken link.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.get(f"/public/tabs/{tab['share_token']}")
        assert response.status_code == 200
        assert response.json()["status"] == "closed"

    def test_a_closed_tab_cannot_be_closed_again(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        again = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert again.status_code == 409

    def test_a_closed_tab_refuses_new_claims(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token = tab["share_token"]
        joined = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()

        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.post(
            f"/public/tabs/{token}/items/{tab['items'][0]['id']}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        # Readable, but no longer writable.
        assert response.status_code == 409

    def test_a_tab_with_no_items_cannot_close(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers, items=[])
        response = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert response.status_code == 409

    def test_an_anonymous_payer_closes_to_a_record_rather_than_an_expense(
        self, client
    ):
        """
        This used to be a 400: balances need a real account behind the payer,
        so an anonymous one was refused outright.

        Refusing was the wrong conclusion from a true premise. When the payer
        has no account there is no debt for Splitwiser to hold — everyone
        settles with them directly, outside the app — so the tab closes to a
        plain record instead. See TestOffAppPayer for why that case is common.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
        ).json()

        response = client.post(
            f"/tabs/{tab['id']}/close",
            json={"payer_participant_id": maya["participant"]["id"]},
            headers=headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "closed"
        # No expense, and so no balance anywhere.
        assert body["expense_id"] is None
        assert body["payer_id"] is None

    def test_a_stranger_cannot_close_your_tab(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.post(
            f"/tabs/{tab['id']}/close", json={}, headers=stranger
        )
        assert response.status_code == 404


class TestClosedTabIsReachableFromItsExpense:
    """
    A closed tab is listed nowhere, so its expense is the only way back to the
    item-by-item board. The expense carries the tab id to make that trip.
    """

    def test_the_expense_points_back_at_the_tab(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
        )

        closed = client.post(
            f"/tabs/{tab['id']}/close", json={}, headers=headers
        ).json()

        expense = client.get(
            f"/expenses/{closed['expense_id']}", headers=headers
        ).json()
        assert expense["tab_id"] == tab["id"]

    def test_an_ordinary_expense_has_no_tab(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        me = client.get("/users/me", headers=headers).json()["id"]
        created = client.post(
            "/expenses/",
            json={
                "description": "Coffee",
                "amount": 500,
                "currency": "USD",
                "date": str(datetime.utcnow().date()),
                "payer_id": me,
                "group_id": None,
                "split_type": "EQUAL",
                "splits": [{"user_id": me, "amount_owed": 500, "is_guest": False}],
            },
            headers=headers,
        )
        assert created.status_code == 200, created.text

        detail = client.get(
            f"/expenses/{created.json()['id']}", headers=headers
        ).json()
        assert detail["tab_id"] is None

    def test_the_tab_stays_shut_to_everyone_else(self, client):
        """
        GET /tabs/{id} answers a non-owner with 404 so it never confirms a tab
        exists. The id travels on the expense only for the owner, so nobody
        else is handed a link they cannot follow.
        """
        owner = register(client, "vince@example.com", "Vince Woo")
        mallory = register(client, "mallory@example.com", "Mallory")
        tab = make_tab(client, owner)
        client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": "Maya"},
        )

        closed = client.post(
            f"/tabs/{tab['id']}/close", json={}, headers=owner
        ).json()

        # Not her expense, and not her tab.
        assert (
            client.get(
                f"/expenses/{closed['expense_id']}", headers=mallory
            ).status_code
            == 403
        )
        assert client.get(f"/tabs/{tab['id']}", headers=mallory).status_code == 404


class TestDeletingTheExpenseATabResolvedInto:
    """
    Deleting the expense is the only way to get rid of a tab, and it has to
    take the tab's claim on that expense id with it: SQLite hands a freed
    rowid straight back to the next insert, so a tab left pointing at a
    deleted expense ends up pointing at somebody else's.
    """

    def _close(self, client, headers, **over):
        tab = make_tab(client, headers, **over)
        closed = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert closed.status_code == 200, closed.text
        return tab, closed.json()["expense_id"]

    def test_deleting_the_expense_detaches_the_tab(self, client, db_session):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab, expense_id = self._close(client, headers)

        assert (
            client.delete(f"/expenses/{expense_id}", headers=headers).status_code == 200
        )

        row = db_session.query(models.Tab).filter(models.Tab.id == tab["id"]).first()
        assert row.expense_id is None
        # Detached, not reopened: the claims were already spent.
        assert row.status == "closed"

    def test_a_deleted_tab_does_not_haunt_the_next_expense(self, client):
        """The reported bug: a new tab's expense opened the tab before it."""
        headers = register(client, "vince@example.com", "Vince Woo")
        _old_tab, old_expense_id = self._close(client, headers, name="Bar Sol")
        assert (
            client.delete(f"/expenses/{old_expense_id}", headers=headers).status_code
            == 200
        )

        new_tab, new_expense_id = self._close(client, headers, name="Taberna Real")
        # The freed rowid comes back — that is what made this reachable at all.
        assert new_expense_id == old_expense_id

        detail = client.get(f"/expenses/{new_expense_id}", headers=headers).json()
        assert detail["tab_id"] == new_tab["id"]

    def test_an_unrelated_expense_does_not_inherit_a_deleted_tab(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        me = client.get("/users/me", headers=headers).json()["id"]
        _tab, expense_id = self._close(client, headers)
        assert (
            client.delete(f"/expenses/{expense_id}", headers=headers).status_code == 200
        )

        created = client.post(
            "/expenses/",
            json={
                "description": "Coffee",
                "amount": 500,
                "currency": "USD",
                "date": str(datetime.utcnow().date()),
                "payer_id": me,
                "group_id": None,
                "split_type": "EQUAL",
                "splits": [{"user_id": me, "amount_owed": 500, "is_guest": False}],
            },
            headers=headers,
        )
        assert created.status_code == 200, created.text
        assert created.json()["id"] == expense_id

        detail = client.get(f"/expenses/{expense_id}", headers=headers).json()
        assert detail["tab_id"] is None


class TestClaimUniqueness:
    def test_the_schema_refuses_a_duplicate_claim(self, client, db_session):
        """
        The router already checks before inserting, but the constraint is the
        backstop for a concurrent double tap that passes both checks.
        """
        from sqlalchemy.exc import IntegrityError

        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        token, item_id = tab["share_token"], tab["items"][0]["id"]

        joined = client.post(
            f"/public/tabs/{token}/join", json={"display_name": "Maya"}
        ).json()
        participant_id = joined["participant"]["id"]

        db_session.add(
            models.TabItemClaim(
                tab_id=tab["id"], item_id=item_id, participant_id=participant_id
            )
        )
        db_session.commit()

        db_session.add(
            models.TabItemClaim(
                tab_id=tab["id"], item_id=item_id, participant_id=participant_id
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()


class TestPublicRateLimiting:
    def test_joining_is_rate_limited(self, client):
        """
        The public join endpoint is unauthenticated and creates rows, so it
        must not be freely hammerable. Other tests disable rate limits via a
        dependency override; this one puts the real limiter back.
        """
        # Take the app from conftest, not `from main import app`:
        # test_cors_security reloads the main module, which leaves a second
        # app object behind. The client fixture is bound to conftest's, so an
        # override popped off the other one would have no effect.
        from conftest import app

        from routers.tabs import tab_join_rate_limiter

        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)

        override = app.dependency_overrides.pop(tab_join_rate_limiter, None)
        # Start from a clean window so earlier tests don't skew the count.
        tab_join_rate_limiter.ip_requests.clear()
        try:
            statuses = [
                client.post(
                    f"/public/tabs/{tab['share_token']}/join",
                    json={"display_name": f"Guest {i}"},
                ).status_code
                for i in range(tab_join_rate_limiter.requests_limit + 3)
            ]
        finally:
            tab_join_rate_limiter.ip_requests.clear()
            if override is not None:
                app.dependency_overrides[tab_join_rate_limiter] = override

        assert 200 in statuses
        assert 429 in statuses
        assert statuses.count(200) <= tab_join_rate_limiter.requests_limit


class TestSelfClaim:
    def test_the_host_can_claim_their_own_items(self, client):
        """
        The host is a participant like anyone else. Their claim token is never
        handed out, so without this route they could not say what they had
        except by opening their own link and joining twice.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        item_id = tab["items"][0]["id"]
        me = tab["participants"][0]["id"]

        response = client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 200
        item = next(i for i in response.json()["items"] if i["id"] == item_id)
        assert item["claimed_by"] == [me]

        released = client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim",
            json={"claimed": False},
            headers=headers,
        )
        item = next(i for i in released.json()["items"] if i["id"] == item_id)
        assert item["claimed_by"] == []

    def test_claiming_twice_is_idempotent(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        item_id = tab["items"][0]["id"]

        for _ in range(3):
            body = client.post(
                f"/tabs/{tab['id']}/items/{item_id}/claim",
                json={"claimed": True},
                headers=headers,
            ).json()

        item = next(i for i in body["items"] if i["id"] == item_id)
        assert len(item["claimed_by"]) == 1

    def test_someone_not_at_the_table_cannot_claim(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        stranger = register(client, "mallory@example.com", "Mallory")

        response = client.post(
            f"/tabs/{tab['id']}/items/{tab['items'][0]['id']}/claim",
            json={"claimed": True},
            headers=stranger,
        )
        # Indistinguishable from a tab that does not exist.
        assert response.status_code == 404

    def test_a_closed_tab_refuses_a_self_claim(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.post(
            f"/tabs/{tab['id']}/items/{tab['items'][0]['id']}/claim",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 409


class TestOwnerSetsClaims:
    """
    The desktop board is a grid of every item against every person. Someone at
    the table always leaves early or never opens the link, so the owner has to
    be able to tick on their behalf.
    """

    def join(self, client, tab, name):
        response = client.post(
            f"/public/tabs/{tab['share_token']}/join",
            json={"display_name": name},
        )
        assert response.status_code == 200, response.text
        return response.json()["participant"]["id"]

    def test_the_owner_can_claim_for_someone_else(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = self.join(client, tab, "Maya")
        item_id = tab["items"][0]["id"]

        response = client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim/{maya}",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 200
        item = next(i for i in response.json()["items"] if i["id"] == item_id)
        assert item["claimed_by"] == [maya]

    def test_the_owner_can_release_someone_elses_claim(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = self.join(client, tab, "Maya")
        item_id = tab["items"][0]["id"]

        client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim/{maya}",
            json={"claimed": True},
            headers=headers,
        )
        body = client.post(
            f"/tabs/{tab['id']}/items/{item_id}/claim/{maya}",
            json={"claimed": False},
            headers=headers,
        ).json()

        item = next(i for i in body["items"] if i["id"] == item_id)
        assert item["claimed_by"] == []

    def test_setting_a_claim_twice_is_idempotent(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = self.join(client, tab, "Maya")
        item_id = tab["items"][0]["id"]

        for _ in range(3):
            body = client.post(
                f"/tabs/{tab['id']}/items/{item_id}/claim/{maya}",
                json={"claimed": True},
                headers=headers,
            ).json()

        item = next(i for i in body["items"] if i["id"] == item_id)
        assert item["claimed_by"] == [maya]

    def test_a_participant_cannot_claim_for_another_participant(self, client):
        """
        The route is owner-only. A signed-in participant who is not the owner
        gets the same 404 a stranger would.
        """
        owner = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, owner)
        maya = self.join(client, tab, "Maya")
        other = register(client, "ben@example.com", "Ben Ortiz")

        response = client.post(
            f"/tabs/{tab['id']}/items/{tab['items'][0]['id']}/claim/{maya}",
            json={"claimed": True},
            headers=other,
        )
        assert response.status_code == 404

    def test_a_participant_from_another_tab_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        mine = make_tab(client, headers)
        theirs = make_tab(client, headers, name="Mission Bowl")
        outsider = self.join(client, theirs, "Dani")

        response = client.post(
            f"/tabs/{mine['id']}/items/{mine['items'][0]['id']}/claim/{outsider}",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 404

    def test_a_closed_tab_refuses_owner_claims_too(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        maya = self.join(client, tab, "Maya")
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.post(
            f"/tabs/{tab['id']}/items/{tab['items'][0]['id']}/claim/{maya}",
            json={"claimed": True},
            headers=headers,
        )
        assert response.status_code == 409


class TestOffAppPayer:
    """
    The organiser and the payer are not always the same person.

    Somebody with no Splitwiser account picks up the cheque; the one person at
    the table who has the app works out the shares. Everybody owes the payer
    directly, outside the app entirely — so the tab has to name them, carry
    their handle, and close without inventing a debt in the organiser's name.
    """

    def seat(self, client, headers, tab, name, venmo=None):
        body = {"display_name": name}
        if venmo is not None:
            body["venmo_username"] = venmo
        response = client.post(
            f"/tabs/{tab['id']}/participants", json=body, headers=headers
        )
        assert response.status_code == 200, response.text
        return next(
            p for p in response.json()["participants"] if p["display_name"] == name
        )

    def test_a_seat_can_carry_a_handle_of_its_own(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana", venmo="@dana-p")

        # Normalised exactly as an account's handle would be.
        assert dana["venmo_username"] == "dana-p"

    def test_naming_the_payer_points_the_link_at_them(self, client):
        """The whole point: the table needs Dana's handle, not the host's."""
        headers = register(client, "vince@example.com", "Vince Woo")
        set_venmo(client, headers, "vince-woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana", venmo="dana-p")

        client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": dana["id"]},
            headers=headers,
        )

        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert public["host_name"] == "Dana"
        assert public["host_venmo_username"] == "dana-p"

    def test_the_creator_is_still_the_default(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        set_venmo(client, headers, "vince-woo")
        tab = make_tab(client, headers)

        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert public["host_name"] == "Vince Woo"
        assert public["host_venmo_username"] == "vince-woo"

    def test_clearing_the_payer_hands_it_back_to_the_creator(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        set_venmo(client, headers, "vince-woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana", venmo="dana-p")
        client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": dana["id"]},
            headers=headers,
        )

        client.post(
            f"/tabs/{tab['id']}/payer", json={"participant_id": None}, headers=headers
        )

        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert public["host_venmo_username"] == "vince-woo"

    def test_an_account_holders_handle_still_comes_from_their_profile(self, client):
        """Not copied onto the seat, so editing the profile is not forked."""
        vince = register(client, "vince@example.com", "Vince Woo")
        maya = register(client, "maya@example.com", "Maya Chen")
        set_venmo(client, maya, "maya-chen")
        tab = make_tab(client, vince)

        joined = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        ).json()
        client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": joined["participant"]["id"]},
            headers=vince,
        )

        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert public["host_venmo_username"] == "maya-chen"
        # And the seat itself never holds a copy.
        seat = next(
            p
            for p in public["participants"]
            if p["id"] == joined["participant"]["id"]
        )
        assert seat["venmo_username"] is None

    def test_a_handle_is_refused_on_a_seat_that_has_an_account(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        maya = register(client, "maya@example.com", "Maya Chen")
        tab = make_tab(client, vince)
        joined = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        ).json()

        response = client.patch(
            f"/tabs/{tab['id']}/participants/{joined['participant']['id']}",
            json={"venmo_username": "not-mine"},
            headers=vince,
        )
        assert response.status_code == 400
        assert "own profile" in response.json()["detail"]

    def test_closing_with_an_off_app_payer_writes_no_expense(self, client):
        """
        Nobody in the app is owed anything, so there is no debt to record.
        Inventing one would put a balance in the organiser's name.
        """
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana", venmo="dana-p")
        client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": dana["id"]},
            headers=headers,
        )

        closed = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
        assert closed.status_code == 200, closed.text
        body = closed.json()
        assert body["status"] == "closed"
        assert body["expense_id"] is None
        assert body["payer_id"] is None
        assert body["payer_participant_id"] == dana["id"]

        # And nothing landed in the organiser's expenses.
        assert client.get("/expenses", headers=headers).json() == []

    def test_an_off_app_payer_can_also_be_named_at_close(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")

        closed = client.post(
            f"/tabs/{tab['id']}/close",
            json={"payer_participant_id": dana["id"]},
            headers=headers,
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["expense_id"] is None

    def test_a_registered_payer_still_produces_an_expense(self, client):
        """The ordinary path is untouched."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        self.seat(client, headers, tab, "Dana")

        body = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers).json()
        assert body["expense_id"] is not None
        assert body["payer_id"] is not None

    def test_the_payer_cannot_be_changed_once_closed(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": dana["id"]},
            headers=headers,
        )
        assert response.status_code == 409

    def test_a_stranger_cannot_name_the_payer(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        mallory = register(client, "mallory@example.com", "Mallory")
        tab = make_tab(client, vince)
        dana = self.seat(client, vince, tab, "Dana")

        response = client.post(
            f"/tabs/{tab['id']}/payer",
            json={"participant_id": dana["id"]},
            headers=mallory,
        )
        assert response.status_code in (403, 404)


class TestMarkingPeoplePaid:
    """
    Who has settled, ticked off by the host.

    Nothing here can verify a payment — the money moves through Venmo, cash or
    a bank transfer, none of which report back. The host standing at the table
    is the only witness there is.
    """

    def seat(self, client, headers, tab, name):
        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": name},
            headers=headers,
        )
        return next(
            p for p in response.json()["participants"] if p["display_name"] == name
        )

    def test_nobody_starts_paid(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        assert all(p["paid"] is False for p in tab["participants"])

    def test_the_host_can_tick_somebody_off(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")

        body = client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        ).json()

        seat = next(p for p in body["participants"] if p["id"] == dana["id"])
        assert seat["paid"] is True

    def test_a_tick_can_be_taken_back(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")
        client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        )

        body = client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": False},
            headers=headers,
        ).json()

        seat = next(p for p in body["participants"] if p["id"] == dana["id"])
        assert seat["paid"] is False

    def test_ticking_somebody_off_leaves_their_handle_alone(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        response = client.post(
            f"/tabs/{tab['id']}/participants",
            json={"display_name": "Dana", "venmo_username": "dana-p"},
            headers=headers,
        ).json()
        dana = next(p for p in response["participants"] if p["display_name"] == "Dana")

        body = client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        ).json()

        seat = next(p for p in body["participants"] if p["id"] == dana["id"])
        assert seat["venmo_username"] == "dana-p"

    def test_the_table_can_see_who_has_settled(self, client):
        """It is the thing everybody keeps asking, so it rides on the link."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")
        client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        )

        public = client.get(f"/public/tabs/{tab['share_token']}").json()
        seat = next(p for p in public["participants"] if p["id"] == dana["id"])
        assert seat["paid"] is True

    def test_people_can_still_be_ticked_off_after_the_tab_closes(self, client):
        """They wander off owing and settle days later. That is the norm."""
        headers = register(client, "vince@example.com", "Vince Woo")
        tab = make_tab(client, headers)
        dana = self.seat(client, headers, tab, "Dana")
        client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)

        response = client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        )
        assert response.status_code == 200
        seat = next(
            p for p in response.json()["participants"] if p["id"] == dana["id"]
        )
        assert seat["paid"] is True

    def test_a_stranger_cannot_tick_anybody_off(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        mallory = register(client, "mallory@example.com", "Mallory")
        tab = make_tab(client, vince)
        dana = self.seat(client, vince, tab, "Dana")

        response = client.patch(
            f"/tabs/{tab['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=mallory,
        )
        assert response.status_code in (403, 404)

    def test_a_seat_from_another_tab_is_not_reachable(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        mine = make_tab(client, headers)
        theirs = make_tab(client, headers, name="Other Place")
        dana = self.seat(client, headers, theirs, "Dana")

        response = client.patch(
            f"/tabs/{mine['id']}/participants/{dana['id']}",
            json={"paid": True},
            headers=headers,
        )
        assert response.status_code == 404
