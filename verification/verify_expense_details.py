
import time
import os
import random
from playwright.sync_api import sync_playwright, expect

def verify_expense_details():
    if not os.path.exists("verification/debug_screenshots"):
        os.makedirs("verification/debug_screenshots", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Register and Login
            rand_id = str(random.randint(1000, 9999))
            email = f"user{rand_id}@example.com"
            print(f"Registering with {email}")

            page.goto("http://localhost:5173/register")
            page.fill('input[type="email"]', email)
            page.fill('input[type="password"]', "password123")
            page.fill('input[placeholder="Full Name"]', "Test User")
            page.click('button[type="submit"]')

            # Wait for dashboard
            expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=10000)

            # 2. Create a Group with USD currency
            page.click('button:has-text("New Group")')
            page.fill('input[type="text"]', "US Trip")
            page.click('button:has-text("Create Group")')

            # Wait for group page
            try:
                expect(page.get_by_role("heading", name="US Trip")).to_be_visible(timeout=3000)
            except:
                page.click('text="US Trip"')
                expect(page.get_by_role("heading", name="US Trip")).to_be_visible(timeout=5000)

            # 3. Add an Expense in EUR
            page.click('button:has-text("Add Expense")')
            page.fill('input[placeholder="Enter a description"]', "Dinner")

            page.locator('input[placeholder="0.00"]').first.fill("50.00")

            # Change currency to EUR
            # The issue was strict mode finding multiple selects and choosing the wrong one which didn't have "EUR"
            # In AddExpenseModal, the currency select is the one that has "USD" selected by default.
            # Or we can select by index (e.g., the second select, if the first is group)
            # Or find the select that contains USD/EUR options.
            # Let's try selecting the one near the amount input.

            # Often the currency select is right before the amount input
            page.locator("select").nth(1).select_option("EUR") # Try the second one

            page.click('button:has-text("Save")')

            # 4. Open Expense Details
            dinner_item = page.locator('button:has-text("Dinner")')
            dinner_item.wait_for(state='visible')
            dinner_item.click()

            # 5. Verify Exchange Rate Field
            expect(page.get_by_role("heading", name="Expense Details")).to_be_visible()

            # Check for "Exchange Rate" label
            expect(page.get_by_text("Exchange Rate")).to_be_visible()

            # Print value
            try:
                 row = page.locator("div.flex.justify-between.text-sm", has_text="Exchange Rate")
                 print(f"Found exchange rate row: {row.inner_text()}")
            except:
                 pass

            help_button = page.locator('button[title*="This exchange rate was captured"]')
            expect(help_button).to_be_visible()

            # 6. Take Screenshot
            page.screenshot(path="verification/verification.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/debug_screenshots/error_final.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_expense_details()
