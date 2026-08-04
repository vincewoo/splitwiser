"""The Venmo handle: normalisation, validation, and who is allowed to see it."""

import pytest


def register(client, email, name):
    client.post(
        "/register",
        json={"email": email, "password": "password123", "full_name": name},
    )
    token = client.post(
        "/token", data={"username": email, "password": "password123"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def set_handle(client, headers, value):
    return client.put(
        "/users/me/profile", json={"venmo_username": value}, headers=headers
    )


def get_handle(client, headers):
    return client.get("/users/me/profile", headers=headers).json()["venmo_username"]


class TestSettingTheHandle:
    def test_a_plain_handle_is_stored_as_given(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        assert set_handle(client, headers, "vince-woo").status_code == 200
        assert get_handle(client, headers) == "vince-woo"

    def test_a_leading_at_is_stripped(self, client):
        """People copy their handle off Venmo, where it is shown with the @."""
        headers = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, headers, "@VinceWoo")
        assert get_handle(client, headers) == "VinceWoo"

    def test_surrounding_whitespace_is_stripped(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, headers, "  @vince_woo  ")
        assert get_handle(client, headers) == "vince_woo"

    def test_nobody_starts_with_one(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        assert get_handle(client, headers) is None

    def test_an_empty_value_clears_it(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, headers, "vince-woo")
        assert set_handle(client, headers, "").status_code == 200
        assert get_handle(client, headers) is None

    def test_whitespace_only_also_clears_it(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, headers, "vince-woo")
        set_handle(client, headers, "   ")
        assert get_handle(client, headers) is None

    def test_omitting_the_field_leaves_it_alone(self, client):
        """Saving the rest of the profile must not wipe the handle."""
        headers = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, headers, "vince-woo")

        client.put(
            "/users/me/profile", json={"full_name": "Vince W"}, headers=headers
        )
        assert get_handle(client, headers) == "vince-woo"

    @pytest.mark.parametrize(
        "bad",
        ["has space", "emoji🙂", "semi;colon", "slash/es", "quote'", "at@sign"],
    )
    def test_unusable_characters_are_refused(self, client, bad):
        headers = register(client, "vince@example.com", "Vince Woo")
        assert set_handle(client, headers, bad).status_code == 422

    def test_an_over_long_handle_is_refused(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        assert set_handle(client, headers, "a" * 31).status_code == 422

    def test_thirty_characters_is_allowed(self, client):
        headers = register(client, "vince@example.com", "Vince Woo")
        assert set_handle(client, headers, "a" * 30).status_code == 200


class TestWhoCanSeeIt:
    def test_a_friend_sees_it_in_the_friends_list(self, client):
        """This is the whole point: settling up needs the other side's handle."""
        vince = register(client, "vince@example.com", "Vince Woo")
        maya = register(client, "maya@example.com", "Maya Chen")
        set_handle(client, maya, "maya-chen")

        client.post("/friends", json={"email": "maya@example.com"}, headers=vince)

        friends = client.get("/friends", headers=vince).json()
        entry = next(f for f in friends if f["email"] == "maya@example.com")
        assert entry["venmo_username"] == "maya-chen"

    def test_a_friend_without_one_reads_as_null(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        register(client, "maya@example.com", "Maya Chen")
        client.post("/friends", json={"email": "maya@example.com"}, headers=vince)

        friends = client.get("/friends", headers=vince).json()
        assert friends[0]["venmo_username"] is None

    def test_a_public_share_link_never_exposes_it(self, client):
        """
        A share link is handed to strangers. A payment handle is exactly the
        sort of thing that must not ride along with it.
        """
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")

        group = client.post(
            "/groups", json={"name": "Tahoe", "default_currency": "USD"}, headers=vince
        ).json()
        share = client.post(f"/groups/{group['id']}/share", headers=vince).json()

        body = client.get(f"/public/groups/{share['share_link_id']}").text
        assert "vince-woo" not in body
        assert "venmo" not in body.lower()

    def test_a_stranger_cannot_read_it_through_the_friends_list(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")
        mallory = register(client, "mallory@example.com", "Mallory")

        # Not friends, so Vince does not appear at all.
        assert client.get("/friends", headers=mallory).json() == []


class TestSettlementDirectory:
    """
    /simplify_debts returns bare ids. Without a directory alongside them the
    caller can only name people it already knows — friends — so a fellow group
    member reads as a number and gets no Venmo hand-off.
    """

    def make_group_with_debt(self, client, owner, other_email, other_name):
        """Owner pays for something split with `other`, so `other` owes them."""
        other = register(client, other_email, other_name)
        group = client.post(
            "/groups", json={"name": "Tahoe", "default_currency": "USD"}, headers=owner
        ).json()
        client.post(
            f"/groups/{group['id']}/members",
            json={"email": other_email},
            headers=owner,
        )

        me = client.get("/users/me", headers=owner).json()
        them = client.get("/users/me", headers=other).json()
        client.post(
            "/expenses",
            json={
                "description": "Groceries",
                "amount": 10000,
                "currency": "USD",
                "date": "2026-07-28",
                "group_id": group["id"],
                "payer_id": me["id"],
                "split_type": "EQUAL",
                "splits": [
                    {"user_id": me["id"], "is_guest": False, "amount_owed": 5000},
                    {"user_id": them["id"], "is_guest": False, "amount_owed": 5000},
                ],
            },
            headers=owner,
        )
        return group, other, them

    def test_participants_name_a_group_member_who_is_not_a_friend(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        group, _, them = self.make_group_with_debt(
            client, owner, "maya@example.com", "Maya Chen"
        )

        body = client.get(f"/simplify_debts/{group['id']}", headers=owner).json()
        entry = next(
            p for p in body["participants"] if p["user_id"] == them["id"]
        )
        assert entry["display_name"] == "Maya Chen"
        assert entry["is_guest"] is False

    def test_participants_carry_the_venmo_handle(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        group, other, them = self.make_group_with_debt(
            client, owner, "maya@example.com", "Maya Chen"
        )
        set_handle(client, other, "maya-chen")

        body = client.get(f"/simplify_debts/{group['id']}", headers=owner).json()
        entry = next(
            p for p in body["participants"] if p["user_id"] == them["id"]
        )
        # Never befriended — group membership alone is enough.
        assert client.get("/friends", headers=owner).json() == []
        assert entry["venmo_username"] == "maya-chen"

    def test_a_member_without_a_handle_reads_as_null(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        group, _, them = self.make_group_with_debt(
            client, owner, "maya@example.com", "Maya Chen"
        )

        body = client.get(f"/simplify_debts/{group['id']}", headers=owner).json()
        entry = next(
            p for p in body["participants"] if p["user_id"] == them["id"]
        )
        assert entry["venmo_username"] is None

    def test_guests_are_named_but_have_no_handle(self, client):
        owner = register(client, "vince@example.com", "Vince Woo")
        group = client.post(
            "/groups", json={"name": "Tahoe", "default_currency": "USD"}, headers=owner
        ).json()
        guest = client.post(
            f"/groups/{group['id']}/guests", json={"name": "Tess"}, headers=owner
        ).json()

        me = client.get("/users/me", headers=owner).json()
        client.post(
            "/expenses",
            json={
                "description": "Groceries",
                "amount": 10000,
                "currency": "USD",
                "date": "2026-07-28",
                "group_id": group["id"],
                "payer_id": me["id"],
                "split_type": "EQUAL",
                "splits": [
                    {"user_id": me["id"], "is_guest": False, "amount_owed": 5000},
                    {"user_id": guest["id"], "is_guest": True, "amount_owed": 5000},
                ],
            },
            headers=owner,
        )

        body = client.get(f"/simplify_debts/{group['id']}", headers=owner).json()
        entry = next(p for p in body["participants"] if p["is_guest"])
        assert entry["display_name"] == "Tess"
        assert entry["venmo_username"] is None

    def test_a_stranger_cannot_read_the_directory(self, client):
        """Membership is what gates this, exactly as it gates the transactions."""
        owner = register(client, "vince@example.com", "Vince Woo")
        group, _, _ = self.make_group_with_debt(
            client, owner, "maya@example.com", "Maya Chen"
        )
        mallory = register(client, "mallory@example.com", "Mallory")

        response = client.get(f"/simplify_debts/{group['id']}", headers=mallory)
        assert response.status_code in (403, 404)


class TestTabLinkHandsOverTheHost:
    """
    The one place a handle reaches somebody who is not a friend or a fellow
    group member.

    A tab is where people most often owe a near-stranger: no group, no
    friendship, and frequently no second meeting. The link is the only channel
    there is, so the host's handle rides along with it — theirs alone, and only
    while the link is live.
    """

    def make_tab(self, client, headers, **over):
        payload = {
            "name": "Bar Sol",
            "currency": "USD",
            "items": [
                {"description": "Pizza margherita", "price": 2800},
                {"description": "Vinho Verde", "price": 3400},
            ],
            "tax": 0,
            "tip": 0,
        }
        payload.update(over)
        return client.post("/tabs", json=payload, headers=headers).json()

    def test_the_link_carries_the_hosts_handle(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")
        tab = self.make_tab(client, vince)

        body = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert body["host_venmo_username"] == "vince-woo"
        assert body["host_name"] == "Vince Woo"

    def test_a_host_without_one_reads_as_null(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        tab = self.make_tab(client, vince)

        body = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert body["host_venmo_username"] is None
        assert body["host_name"] == "Vince Woo"

    def test_another_claimers_handle_never_rides_along(self, client):
        """Only the person owed. Everyone else at the table keeps theirs."""
        vince = register(client, "vince@example.com", "Vince Woo")
        maya = register(client, "maya@example.com", "Maya Chen")
        set_handle(client, maya, "maya-chen")
        tab = self.make_tab(client, vince)

        client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        )

        body = client.get(f"/public/tabs/{tab['share_token']}").text
        assert "maya-chen" not in body

    def test_a_revoked_link_hands_over_nothing_at_all(self, client):
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")
        tab = self.make_tab(client, vince)
        client.post(f"/tabs/{tab['id']}/revoke", headers=vince)

        response = client.get(f"/public/tabs/{tab['share_token']}")
        assert response.status_code in (403, 404, 410)
        assert "vince-woo" not in response.text

    def test_closing_follows_the_bill_to_whoever_actually_paid(self, client):
        """
        The host can hand the bill to someone else at close. From then on the
        table owes that person, so that person's handle is the useful one.
        """
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")
        maya = register(client, "maya@example.com", "Maya Chen")
        set_handle(client, maya, "maya-chen")
        tab = self.make_tab(client, vince)

        joined = client.post(
            f"/public/tabs/{tab['share_token']}/join", json={}, headers=maya
        ).json()
        # Somebody has to have claimed something for the close to be meaningful.
        item = tab["items"][0]["id"]
        client.post(
            f"/public/tabs/{tab['share_token']}/items/{item}/claim",
            json={"claim_token": joined["claim_token"], "claimed": True},
        )
        client.post(
            f"/tabs/{tab['id']}/close",
            json={"payer_participant_id": joined["participant"]["id"]},
            headers=vince,
        )

        body = client.get(f"/public/tabs/{tab['share_token']}").json()
        assert body["host_venmo_username"] == "maya-chen"
        assert body["host_name"] == "Maya Chen"

    def test_a_group_share_link_still_exposes_nothing(self, client):
        """The tab carve-out is a carve-out, not a general loosening."""
        vince = register(client, "vince@example.com", "Vince Woo")
        set_handle(client, vince, "vince-woo")

        group = client.post(
            "/groups", json={"name": "Tahoe", "default_currency": "USD"}, headers=vince
        ).json()
        share = client.post(f"/groups/{group['id']}/share", headers=vince).json()

        body = client.get(f"/public/groups/{share['share_link_id']}").text
        assert "vince-woo" not in body
